import { auth, db } from "/js/firebase.js";
import {
    onAuthStateChanged,
    signOut,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
    collection,
    query,
    where,
    onSnapshot,
    updateDoc,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    orderBy,
    deleteDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const logoutBtn = document.getElementById("logoutBtn");
const appointmentsList = document.getElementById("appointmentsList");
const messagesList = document.getElementById("messagesList");
const resetPasswordBtn = document.getElementById("resetPasswordBtn");

let currentUser = null;
let currentProfile = null;

// Check if teacher is logged in
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }


    currentUser = user;

    const teacherDoc = await getDoc(doc(db, "users", user.uid));
    if (!teacherDoc.exists() || teacherDoc.data().role !== "teacher") {
        alert("Access denied! Only teachers allowed.");
        window.location.href = "login.html";
        return;
    }

    const teacherData = teacherDoc.data();
    currentProfile = teacherData;

    document.getElementById("teacherInfo").textContent =
        `Welcome, ${teacherData.name.toUpperCase() ?? "(No Name)"} | Role: ${teacherData.role}`;

    //  Fetch appointments...
    const qAppointments = query(
        collection(db, "appointments"),
        where("teacherId", "==", user.uid)
    );

    onSnapshot(qAppointments, (snapshot) => {
        appointmentsList.innerHTML = "";
        snapshot.forEach((docSnap) => {
            const appt = docSnap.data();
            const li = document.createElement("li");
            li.style.listStyleType = "none";
            li.innerHTML = `
           <b>${appt.studentName.toUpperCase()}</b> requested on <b>${appt.date} at ${appt.time}</b> 
           [${appt.status}] 
            <button class="btn btn-success btn-sm m-3" data-id="${docSnap.id}" data-action="approve">Approve</button>
            <button class="btn btn-danger btn-sm " data-id="${docSnap.id}" data-action="cancel">Cancel</button>
          `;
            appointmentsList.appendChild(li);
        });
    });


    //  NOW start messages snapshot
    //  Show list of students (teacher can pick chat)
    const qMessages = query(collection(db, "conversations"));
    onSnapshot(qMessages, (snapshot) => {
        messagesList.innerHTML = "";

        snapshot.forEach((docSnap) => {
            const conv = docSnap.data();
            if (conv.teacherId === currentUser.uid) {
                const li = document.createElement("li");
                li.classList.add("list-group-item", "d-flex", "justify-content-between", "align-items-center");

                li.innerHTML = `
             <span>${conv.studentName ?? conv.studentEmail}</span>
             <button class="btn btn-outline-primary btn-sm openChatBtn"
               data-student-id="${conv.studentId}"
               data-student-name="${conv.studentName}"
               data-student-email="${conv.studentEmail}">
               Open Chat
              </button>
            `;
                messagesList.appendChild(li);
            }
        });
    });


    //  Handle "Open Chat" click
    messagesList.addEventListener("click", (e) => {
        if (e.target.classList.contains("openChatBtn")) {
            const studentId = e.target.getAttribute("data-student-id");
            const studentName = e.target.getAttribute("data-student-name");
            const studentEmail = e.target.getAttribute("data-student-email");

            // Load this student's conversation
            listenToConversation(studentId, studentName, studentEmail);

            // Enable Send button
            document.getElementById("sendBtn").onclick = async () => {
                const text = document.getElementById("chatInput").value.trim();
                if (!text) return;
                await replyToStudent(studentId, studentName, studentEmail, text);
                document.getElementById("chatInput").value = "";
            };

            // Enable Clear Chat button
            document.getElementById("clearChatBtn").onclick = async () => {
                if (confirm(`Clear chat with ${studentName || studentEmail}?`)) {
                    await clearConversation(studentId);
                }
            };
        }
    });


    function getConversationId(studentId, teacherId) {
        return [studentId, teacherId].sort().join("_");
    }

    // Listen to conversation with student
    function listenToConversation(studentId, studentName, studentEmail) {
        activeStudentId = studentId;

        const conversationId = getConversationId(studentId, currentUser.uid);
        const qRef = query(
            collection(db, "conversations", conversationId, "messages"),
            orderBy("createdAt", "asc")
        );

        onSnapshot(qRef, (snap) => {
            const chatBox = document.getElementById("chatBox");
            chatBox.innerHTML = "";

            if (snap.empty) {
                // 👇 Show message if no chat
                chatBox.innerHTML = `<p class="text-muted text-center">No chat messages yet.</p>`;
                return;
            }

            snap.forEach((docSnap) => {
                const msg = docSnap.data();
                const isMine = msg.fromId === currentUser.uid;
                const bubble = document.createElement("div");
                bubble.style.textAlign = isMine ? "right" : "left";
                bubble.innerHTML = `
            <div class="bubble ${isMine ? "mine" : ""}">
              ${msg.text}
              <div class="muted" style="font-size:10px;">
                 ${msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : ""}
              </div>
            </div>
           `;
                chatBox.appendChild(bubble);
            });
            chatBox.scrollTop = chatBox.scrollHeight;
        });
    }

    // Send teacher → student reply
    async function replyToStudent(studentId, studentName, studentEmail, text) {
        const conversationId = getConversationId(studentId, currentUser.uid);

        const convRef = doc(db, "conversations", conversationId);
        const convSnap = await getDoc(convRef);
        if (!convSnap.exists()) {
            await setDoc(convRef, {
                studentId,
                studentName,
                studentEmail,
                teacherId: currentUser.uid,
                teacherName: currentProfile?.name ?? currentUser.email,
                createdAt: serverTimestamp()
            });
        }

        await addDoc(collection(convRef, "messages"), {
            fromId: currentUser.uid,
            fromName: currentProfile?.name ?? currentUser.email,
            toId: studentId,
            toName: studentName || studentEmail,
            text,
            createdAt: serverTimestamp()
        });
    }

    //  Clear all messages in a conversation
    let activeStudentId = null;

    document.getElementById("clearChatBtn").addEventListener("click", () => {
        if (!activeStudentId) {
            alert("⚠️ No active chat selected.");
            return;
        }

        if (confirm("Are you sure you want to clear this chat?")) {
            clearConversation(activeStudentId);
        }
    });

    async function clearConversation(studentId) {
        const conversationId = getConversationId(studentId, currentUser.uid);
        const convRef = collection(db, "conversations", conversationId, "messages");

        try {
            const snap = await getDocs(convRef);

            if (snap.empty) {
                alert("No messages to clear.");
                return;
            }

            const deletePromises = snap.docs.map((docSnap) => deleteDoc(docSnap.ref));
            await Promise.all(deletePromises);

            // Clear chat box UI
            document.getElementById("chatBox").innerHTML = "";

            alert("🗑️ Chat cleared successfully!");
        } catch (err) {
            console.error("Error clearing chat:", err.message);
            alert("❌ Failed to clear chat: " + err.message);
        }
    }



    // Event: when teacher clicks reply on a student message
    messagesList.addEventListener("click", (e) => {
        if (e.target.classList.contains("replyBtn")) {
            const studentId = e.target.getAttribute("data-student-id");
            const studentName = e.target.getAttribute("data-student-name");
            const studentEmail = e.target.getAttribute("data-student-email");

            // Load chat
            listenToConversation(studentId, studentName || studentEmail);

            // Send reply
            document.getElementById("sendBtn").onclick = async () => {
                const text = document.getElementById("chatInput").value.trim();
                if (!text) return;
                await replyToStudent(studentId, studentName, studentEmail, text);
                document.getElementById("chatInput").value = "";
            };
        }
    });




    // Reset Password Button
    resetPasswordBtn.addEventListener("click", async () => {
        try {
            await sendPasswordResetEmail(auth, user.email);
            alert(`📩 Password reset link sent to ${user.email}. Please check your inbox.`);
        } catch (err) {
            console.error(err);
            alert("❌ Error sending reset link: " + err.message);
        }
    });


    //  Handle approve/cancel buttons
    appointmentsList.addEventListener("click", async (e) => {
        if (e.target.tagName === "BUTTON") {
            const apptId = e.target.getAttribute("data-id");
            const action = e.target.getAttribute("data-action");

            const apptRef = doc(db, "appointments", apptId);
            await updateDoc(apptRef, {
                status: action === "approve" ? "approved" : "cancelled"
            });

            alert(`Appointment ${action}d successfully!`);
        }
    });

    // Logout
    logoutBtn.addEventListener("click", async () => {
        await signOut(auth);
        window.location.href = "login.html";
    });

});