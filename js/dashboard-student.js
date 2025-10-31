import { auth, db } from "../js/firebase.js";

// Firestore
import {
    collection,
    query,
    where,
    onSnapshot,
    updateDoc,
    doc,
    getDocs,
    getDoc,
    setDoc,
    orderBy,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Auth
import {
    onAuthStateChanged,
    sendPasswordResetEmail,
    signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

let currentUser = null;
let currentProfile = null;
let bookModal = null;
let conversationUnsubscribe = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    currentUser = user;

    try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));
        if (!profileSnap.exists()) {
            alert("Profile not found. Please register again.");
            await signOut(auth);
            window.location.href = "register.html";
            return;
        }
        currentProfile = profileSnap.data();

        if (currentProfile.role !== "student") {
            if (currentProfile.role === "teacher") window.location.href = "dashboard-teacher.html";
            else if (currentProfile.role === "admin") window.location.href = "dashboard-admin.html";
            else window.location.href = "login.html";
            return;
        }

        if (currentProfile.active === false) {
            alert("Your account is pending approval by the admin.");
            await signOut(auth);
            window.location.href = "login.html";
            return;
        }

        // Initialize Bootstrap modal
        bookModal = new bootstrap.Modal(document.getElementById("bookDialog"));

        // Display user info
        document.getElementById("studentInfo").textContent =
            `Name: ${currentProfile.name.toUpperCase() ?? "(No Name)"} | Role: ${currentProfile.role}`;

        // Load initial data
        await loadTeachers();
        setupAppointmentsListener();
        setupChatInput();

    } catch (error) {
        console.error("Error loading profile:", error);
        alert("Error loading profile. Please try again.");
    }
});

// ---------- Logout ----------
document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
        if (conversationUnsubscribe) conversationUnsubscribe();
        await signOut(auth);
        window.location.href = "login.html";
    } catch (error) {
        console.error("Logout error:", error);
    }
});

// ---------- Teachers ----------
let allTeachers = [];
const teacherGrid = document.getElementById("teacherGrid");
const noTeachersEl = document.getElementById("noTeachers");
const searchInput = document.getElementById("searchInput");

async function loadTeachers() {
    try {
        const q = query(collection(db, "users"), where("role", "==", "teacher"));
        const snap = await getDocs(q);
        allTeachers = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(t => t.active !== false);
        renderTeachers(allTeachers);
    } catch (error) {
        console.error("Error loading teachers:", error);
        alert("Error loading teachers. Please try again.");
    }
}

function renderTeachers(list) {
    teacherGrid.innerHTML = "";
    if (!list.length) {
        noTeachersEl.classList.remove("d-none");
        return;
    }
    noTeachersEl.classList.add("d-none");

    list.forEach(t => {
        const cardCol = document.createElement("div");
        cardCol.className = "col-md-6 col-lg-4";
        cardCol.innerHTML = `
          <div class="card h-100">
            <div class="card-body">
              <h5 class="card-title">${t.name ?? "Unnamed Teacher"}</h5>
              <p class="card-text text-muted">${t.domain ?? ""}</p>
              <p class="card-text text-muted">${t.email ?? ""}</p>
              <button class="btn btn-primary" data-book="${t.id}">Book Appointment</button>
            </div>
          </div>
        `;
        teacherGrid.appendChild(cardCol);
    });
}

searchInput.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = allTeachers.filter(t =>
        (t.name ?? "").toLowerCase().includes(q) ||
        (t.domain ?? "").toLowerCase().includes(q) ||
        (t.department ?? "").toLowerCase().includes(q) ||
        (t.subject ?? "").toLowerCase().includes(q)
    );
    renderTeachers(filtered);
});

document.getElementById("refreshBtn").addEventListener("click", loadTeachers);

// ---------- Booking ----------
const dialogTitle = document.getElementById("dialogTitle");
const dialogTeacherMeta = document.getElementById("dialogTeacherMeta");
const bookForm = document.getElementById("bookForm");
const dateInput = document.getElementById("dateInput");
const timeInput = document.getElementById("timeInput");

let selectedTeacher = null;

// Set minimum date to today
const today = new Date().toISOString().split('T')[0];
dateInput.min = today;

teacherGrid.addEventListener("click", (e) => {
    const tid = e.target.getAttribute("data-book");
    if (tid) {
        selectedTeacher = allTeachers.find(t => t.id === tid);
        if (selectedTeacher) {
            dialogTitle.textContent = `Book: ${selectedTeacher.name ?? "Teacher"}`;
            dialogTeacherMeta.textContent = `${selectedTeacher.domain ?? ""} ${selectedTeacher.department ? '· ' + selectedTeacher.department : ''}`;
            dateInput.value = "";
            timeInput.value = "";
            bookModal.show();
        }
    }
});

bookForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedTeacher || !currentUser) return;

    if (!dateInput.value || !timeInput.value) {
        alert("Please select both date and time.");
        return;
    }

    // Check if selected time is in the past
    const selectedDateTime = new Date(`${dateInput.value}T${timeInput.value}`);
    if (selectedDateTime < new Date()) {
        alert("Cannot book appointments in the past.");
        return;
    }

    try {
        // Check if teacher already has an approved appointment at this slot
        const qRef = query(
            collection(db, "appointments"),
            where("teacherId", "==", selectedTeacher.id),
            where("date", "==", dateInput.value),
            where("time", "==", timeInput.value),
            where("status", "==", "approved")
        );
        const snap = await getDocs(qRef);

        if (!snap.empty) {
            alert("⛔ This teacher is already booked at that time. Please choose another slot.");
            return;
        }

        // Create new pending appointment
        await addDoc(collection(db, "appointments"), {
            studentId: currentUser.uid,
            studentName: currentProfile?.name ?? currentUser.email,
            teacherId: selectedTeacher.id,
            teacherName: selectedTeacher?.name ?? "",
            date: dateInput.value,
            time: timeInput.value,
            status: "pending",
            createdAt: serverTimestamp()
        });

        bookModal.hide();
        alert("✅ Appointment requested successfully! Waiting for teacher approval.");

    } catch (err) {
        console.error("Booking error:", err);
        alert("Error booking appointment. Please try again.");
    }
});

// ---------- My Appointments + Message Dropdown Update ----------
const appointmentsList = document.getElementById("appointmentsList");
const teacherSelect = document.getElementById("teacherSelect");

function setupAppointmentsListener() {
    const qRef = query(
        collection(db, "appointments"),
        where("studentId", "==", currentUser.uid),
        orderBy("createdAt", "desc")
    );

    onSnapshot(qRef, (snap) => {
        appointmentsList.innerHTML = "";

        // Preserve the default option and clear others
        teacherSelect.innerHTML = '<option value="">Select a teacher</option>';

        const teacherSet = new Map();
        const noAppointments = document.getElementById("noAppointments");

        if (snap.empty) {
            noAppointments.classList.remove("d-none");
        } else {
            noAppointments.classList.add("d-none");

            snap.forEach(docSnap => {
                const a = docSnap.data();

                // Add approved teachers to chat dropdown
                if (a.status === "approved") {
                    teacherSet.set(a.teacherId, a.teacherName);
                }

                // Create appointment list item
                const item = document.createElement("li");
                item.className = "list-group-item d-flex justify-content-between align-items-start";

                const statusClass =
                    a.status === "approved"
                        ? "bg-success text-white"
                        : a.status === "cancelled"
                            ? "bg-danger text-white"
                            : "bg-warning text-dark";

                item.innerHTML = `
              <div class="flex-grow-1">
                <div class="fw-bold">${a.teacherName}</div>
                <div>${a.date} at ${a.time}</div>
                <small class="text-muted">Requested: ${a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString() : "Just now"}</small>
              </div>
              <span class="badge ${statusClass} rounded-pill">${a.status.toUpperCase()}</span>
            `;
                appointmentsList.appendChild(item);
            });
        }

        // Populate chat teacher dropdown
        teacherSet.forEach((name, id) => {
            const opt = document.createElement("option");
            opt.value = id;
            opt.textContent = name;
            teacherSelect.appendChild(opt);
        });

        // Update send button state
        updateSendButtonState();
    });
}

// ---------- Student Messaging ----------
function getConversationId(studentId, teacherId) {
    return [studentId, teacherId].sort().join("_");
}

// Listen to active conversation with selected teacher
function listenToConversation(teacherId, teacherName) {
    // Clean up previous listener
    if (conversationUnsubscribe) {
        conversationUnsubscribe();
    }

    const conversationId = getConversationId(currentUser.uid, teacherId);
    const qRef = query(
        collection(db, "conversations", conversationId, "messages"),
        orderBy("createdAt", "asc")
    );

    conversationUnsubscribe = onSnapshot(qRef, (snap) => {
        const chatBox = document.getElementById("chatBox");
        const noChatMsg = document.getElementById("noChatMsg");

        if (snap.empty) {
            chatBox.innerHTML = '<p class="text-muted text-center" id="noChatMsg">No chat messages yet.</p>';
        } else {
            chatBox.innerHTML = "";
            snap.forEach((docSnap) => {
                const msg = docSnap.data();
                const isMine = msg.fromId === currentUser.uid;
                const bubble = document.createElement("div");
                bubble.style.textAlign = isMine ? "right" : "left";
                bubble.innerHTML = `
              <div class="bubble ${isMine ? "mine" : ""}">
                ${escapeHtml(msg.text)}
                <div class="text-muted" style="font-size:11px; margin-top:4px;">
                  ${msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "numeric",
                    hour12: true
                })
                        : "Sending..."}
                </div>
              </div>
            `;
                chatBox.appendChild(bubble);
            });
        }
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

// Utility function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Send student → teacher message
async function sendMessageToTeacher(teacherId, teacherName, text) {
    try {
        const conversationId = getConversationId(currentUser.uid, teacherId);

        const convRef = doc(db, "conversations", conversationId);
        const convSnap = await getDoc(convRef);
        if (!convSnap.exists()) {
            await setDoc(convRef, {
                studentId: currentUser.uid,
                studentName: currentProfile?.name ?? currentUser.email,
                teacherId,
                teacherName,
                createdAt: serverTimestamp()
            });
        }

        await addDoc(collection(convRef, "messages"), {
            fromId: currentUser.uid,
            fromName: currentProfile?.name ?? currentUser.email,
            toId: teacherId,
            toName: teacherName,
            text: text.trim(),
            createdAt: serverTimestamp()
        });

    } catch (error) {
        console.error("Error sending message:", error);
        alert("Error sending message. Please try again.");
    }
}

// Update send button state
function updateSendButtonState() {
    const sendBtn = document.getElementById("sendBtn");
    const chatInput = document.getElementById("chatInput");
    const hasTeacher = teacherSelect.value !== "";
    const hasText = chatInput.value.trim() !== "";
    sendBtn.disabled = !(hasTeacher && hasText);
}

// Setup chat input functionality
function setupChatInput() {
    const chatInput = document.getElementById("chatInput");
    const sendBtn = document.getElementById("sendBtn");

    chatInput.addEventListener("input", updateSendButtonState);
    chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !sendBtn.disabled) {
            sendBtn.click();
        }
    });
}

// Event: select teacher in dropdown
teacherSelect.addEventListener("change", () => {
    const teacherId = teacherSelect.value;
    if (!teacherId) {
        if (conversationUnsubscribe) {
            conversationUnsubscribe();
        }
        const chatBox = document.getElementById("chatBox");
        chatBox.innerHTML = '<p class="text-muted text-center" id="noChatMsg">No chat messages yet.</p>';
    } else {
        const teacherName = teacherSelect.options[teacherSelect.selectedIndex].text;
        listenToConversation(teacherId, teacherName);
    }
    updateSendButtonState();
});

// Event: send button
document.getElementById("sendBtn").addEventListener("click", async () => {
    const chatInput = document.getElementById("chatInput");
    const text = chatInput.value.trim();
    const teacherId = teacherSelect.value;

    if (!text || !teacherId) return;

    const teacherName = teacherSelect.options[teacherSelect.selectedIndex].text;

    // Clear input immediately for better UX
    chatInput.value = "";
    updateSendButtonState();

    await sendMessageToTeacher(teacherId, teacherName, text);
});
