import { auth, db, firebaseConfig } from "./firebase.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

import {
    collection, query, where, onSnapshot, updateDoc, doc, getDocs,
    getDoc, addDoc, serverTimestamp, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import {
    getAuth, createUserWithEmailAndPassword, onAuthStateChanged,
    sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";


let currentUser = null;
let currentProfile = null;
let allTeachers = [];
let allStudents = [];
let editModal = null;

const elements = {
    // Forms
    addTeacherForm: document.getElementById("addTeacherForm"),
    editTeacherForm: document.getElementById("editTeacherForm"),

    // Status & Info
    adminInfo: document.getElementById("adminInfo"),
    status: document.getElementById("status"),

    // Buttons
    logoutBtn: document.getElementById("logoutBtn"),
    teacherRefresh: document.getElementById("teacherRefresh"),
    studentRefresh: document.getElementById("studentRefresh"),
    togglePassword: document.getElementById("togglePassword"),

    // Search inputs
    teacherSearch: document.getElementById("teacherSearch"),
    studentSearch: document.getElementById("studentSearch"),

    // Lists
    teachersList: document.getElementById("teachersList"),
    studentsList: document.getElementById("studentsList"),
    pendingStudents: document.getElementById("pendingStudents"),

    // Empty states
    noTeachers: document.getElementById("noTeachers"),
    noStudents: document.getElementById("noStudents"),
    noPending: document.getElementById("noPending"),

    // Modal elements
    editModal: document.getElementById("editTeacherModal"),
    editTeacherId: document.getElementById("editTeacherId"),
    editTeacherName: document.getElementById("editTeacherName"),
    editTeacherDomain: document.getElementById("editTeacherDomain"),
    editTeacherEmail: document.getElementById("editTeacherEmail"),
};

// Audit logging function
async function logAction(action, details = {}) {
    try {
        await addDoc(collection(db, "logs"), {
            action,
            details,
            actorId: currentUser?.uid || null,
            actorEmail: currentUser?.email || null,
            actorRole: "admin",
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.warn("Audit log failed:", e.message);
    }
}

// Show status message
function showStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.className = `text-center mt-3 ${isError ? 'text-danger' : 'text-success'}`;
    setTimeout(() => elements.status.textContent = "", 5000);
}

// Create badge element
function createBadge(text, type) {
    const badgeClasses = {
        success: 'badge bg-success',
        warning: 'badge bg-warning text-dark',
        danger: 'badge bg-danger',
        secondary: 'badge bg-secondary'
    };
    return `<span class="${badgeClasses[type] || badgeClasses.secondary}">${text}</span>`;
}

// AUTHENTICATION & INITIALIZATION
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    currentUser = user;
    console.log("Admin logged in:", user.email);

    try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));

        if (!profileSnap.exists()) {
            alert("Admin profile not found!");
            await signOut(auth);
            window.location.href = "login.html";
            return;
        }

        currentProfile = profileSnap.data();

        if (currentProfile.role !== "admin") {
            alert("Access denied! Admin privileges required.");
            await signOut(auth);
            window.location.href = "login.html";
            return;
        }

        // Initialize UI
        elements.adminInfo.textContent =
            `Welcome, ${currentProfile.name.toUpperCase() || "Admin"} | Role: ${currentProfile.role}`;

        // Initialize Bootstrap modal
        editModal = new bootstrap.Modal(elements.editModal);

        // Start data subscriptions
        initializeDataSubscriptions();

    } catch (error) {
        console.error("Profile loading error:", error);
        showStatus("Error loading profile. Please refresh.", true);
    }
});

function initializeDataSubscriptions() {
    subscribeTeachers();
    subscribeStudents();
    subscribePendingStudents();
}

// Teachers subscription
function subscribeTeachers() {
    const teachersQuery = query(collection(db, "users"), where("role", "==", "teacher"));
    onSnapshot(teachersQuery, (snapshot) => {
        allTeachers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderTeachers(allTeachers);
    });
}

// Students subscription
function subscribeStudents() {
    const studentsQuery = query(collection(db, "users"), where("role", "==", "student"));
    onSnapshot(studentsQuery, (snapshot) => {
        allStudents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderStudents(allStudents);
    });
}

// Pending students subscription
function subscribePendingStudents() {
    const pendingQuery = query(
        collection(db, "users"),
        where("role", "==", "student"),
        where("active", "==", false)
    );

    onSnapshot(pendingQuery, (snapshot) => {
        renderPendingStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
}

function renderTeachers(teachers) {
    const searchTerm = elements.teacherSearch.value.toLowerCase().trim();
    const filtered = teachers.filter(teacher =>
        (teacher.name || "").toLowerCase().includes(searchTerm) ||
        (teacher.email || "").toLowerCase().includes(searchTerm) ||
        (teacher.domain || "").toLowerCase().includes(searchTerm)
    );

    elements.teachersList.innerHTML = "";

    if (filtered.length === 0) {
        elements.noTeachers.classList.remove("d-none");
        return;
    }

    elements.noTeachers.classList.add("d-none");

    filtered.forEach(teacher => {
        const teacherCard = createTeacherCard(teacher);
        elements.teachersList.appendChild(teacherCard);
    });
}

function createTeacherCard(teacher) {
    const card = document.createElement("div");
    card.className = "list-item";

    const statusBadge = teacher.active === false
        ? createBadge("Suspended", "danger")
        : createBadge("Active", "success");

    card.innerHTML = `
        <div class="mb-5 border-bottom pb-2 d-flex justify-content-between align-items-center">
          <div>
            <h6 class="mb-1">${teacher.name.toUpperCase() || "Unnamed Teacher"} ${statusBadge}</h6>
            <small class="text-muted">${teacher.email || "No email"}</small><br>
            <small class="text-muted">Domain: ${teacher.domain || "Not specified"}</small>
          </div>
          <div class="btn-group-actions">
            <button class="btn btn-sm btn-outline-primary" onclick="openEditTeacher('${teacher.id}')">
               Edit
            </button>
            <button class="btn btn-sm btn-outline-${teacher.active === false ? 'success' : 'warning'}" 
                  onclick="toggleTeacherStatus('${teacher.id}', ${teacher.active !== false})">
              ${teacher.active === false ? '✅ Activate' : '⛔ Suspend'}
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteTeacher('${teacher.id}')">
              Delete
            </button>
          </div>
        </div>
      `;

    return card;
}

function renderStudents(students) {
    const searchTerm = elements.studentSearch.value.toLowerCase().trim();
    const filtered = students.filter(student =>
        (student.name || "").toLowerCase().includes(searchTerm) ||
        (student.email || "").toLowerCase().includes(searchTerm)
    );

    elements.studentsList.innerHTML = "";

    if (filtered.length === 0) {
        elements.noStudents.classList.remove("d-none");
        return;
    }

    elements.noStudents.classList.add("d-none");

    filtered.forEach(student => {
        const studentCard = createStudentCard(student);
        elements.studentsList.appendChild(studentCard);
    });
}

function createStudentCard(student) {
    const card = document.createElement("div");
    card.className = "list-item";

    let statusBadge;
    if (student.active === false) {
        statusBadge = createBadge("Pending", "warning");
    } else if (student.active === true) {
        statusBadge = createBadge("Approved", "success");
    } else {
        statusBadge = createBadge("Inactive", "danger");
    }

    card.innerHTML = `
        <div>
          <h6 class="mb-1">${student.name || "Unnamed Student"} ${statusBadge}</h6>
          <small class="text-muted">${student.email || "No email"}</small><br>
          <small class="text-muted">Registered: ${student.createdAt?.toDate?.()?.toLocaleDateString() || "Unknown"}</small>
        </div>
        <div class="btn-group-actions">
          ${student.active === false ?
            `<button class="btn btn-sm btn-outline-success" onclick="approveStudent('${student.id}')">
              ✅ Approve
            </button>` :
            `<span class="btn btn-sm btn-success disabled">✅ Approved</span>`
        }
          <button class="btn btn-sm btn-outline-danger" onclick="deleteStudent('${student.id}')">
            🗑️ Delete
          </button>
        </div>
      `;

    return card;
}

function renderPendingStudents(pendingStudents) {
    elements.pendingStudents.innerHTML = "";

    if (pendingStudents.length === 0) {
        elements.noPending.classList.remove("d-none");
        return;
    }

    elements.noPending.classList.add("d-none");

    pendingStudents.forEach(student => {
        const card = document.createElement("div");
        card.className = "list-item";

        card.innerHTML = `
          <div>
            <h6 class="mb-1">${student.name || "Unnamed Student"} ${createBadge("Pending", "warning")}</h6>
            <small class="text-muted">${student.email || "No email"}</small><br>
            <small class="text-muted">Applied: ${student.createdAt?.toDate?.()?.toLocaleDateString() || "Unknown"}</small>
          </div>
          <div class="btn-group-actions">
            <button class="btn btn-sm btn-success" onclick="approveStudent('${student.id}')">
              ✅ Approve
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="rejectStudent('${student.id}')">
              ❌ Reject
            </button>
          </div>
        `;

        elements.pendingStudents.appendChild(card);
    });
}



// Add teacher form
elements.addTeacherForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = {
        name: document.getElementById("teacherName").value.trim(),
        email: document.getElementById("teacherEmail").value.trim(),
        password: document.getElementById("password").value,
        domain: document.getElementById("teacherDomain").value.trim()
    };

    if (!formData.name || !formData.email || !formData.password || !formData.domain) {
        showStatus("All fields are required!", true);
        return;
    }

    try {
        // Create secondary app to avoid logout
        const secondaryApp = initializeApp(firebaseConfig, "Secondary");
        const secondaryAuth = getAuth(secondaryApp);

        const userCredential = await createUserWithEmailAndPassword(
            secondaryAuth,
            formData.email,
            formData.password
        );

        // Create user document
        await setDoc(doc(db, "users", userCredential.user.uid), {
            name: formData.name,
            email: formData.email,
            role: "teacher",
            domain: formData.domain,
            active: true,
            createdAt: serverTimestamp()
        });

        // Log action
        await logAction("admin_add_teacher", {
            teacherId: userCredential.user.uid,
            name: formData.name,
            email: formData.email,
            domain: formData.domain
        });

        // Cleanup
        await signOut(secondaryAuth);
        elements.addTeacherForm.reset();
        showStatus(`✅ Teacher "${formData.name}" added successfully!`);

    } catch (error) {
        console.error("Add teacher error:", error);
        showStatus(`❌ ${error.message}`, true);
    }
});

// Edit teacher form
elements.editTeacherForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const teacherId = elements.editTeacherId.value;
    const updates = {
        name: elements.editTeacherName.value.trim(),
        domain: elements.editTeacherDomain.value.trim()
    };

    try {
        await updateDoc(doc(db, "users", teacherId), updates);
        await logAction("admin_edit_teacher", { teacherId, ...updates });

        editModal.hide();
        showStatus("✅ Teacher updated successfully!");

    } catch (error) {
        console.error("Edit teacher error:", error);
        showStatus(`❌ ${error.message}`, true);
    }
});

// Password toggle
elements.togglePassword.addEventListener("click", () => {
    const passwordInput = document.getElementById("password");
    const isPassword = passwordInput.type === "password";

    passwordInput.type = isPassword ? "text" : "password";
    elements.togglePassword.textContent = isPassword ? "Hide" : "Show";
});

// Logout
elements.logoutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        window.location.href = "login.html";
    } catch (error) {
        console.error("Logout error:", error);
        showStatus("❌ Logout failed", true);
    }
});

// Search handlers
elements.teacherSearch.addEventListener("input", () => renderTeachers(allTeachers));
elements.studentSearch.addEventListener("input", () => renderStudents(allStudents));

// Refresh handlers
elements.teacherRefresh.addEventListener("click", () => renderTeachers(allTeachers));
elements.studentRefresh.addEventListener("click", () => renderStudents(allStudents));


window.openEditTeacher = (teacherId) => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (!teacher) return;

    elements.editTeacherId.value = teacher.id;
    elements.editTeacherName.value = teacher.name || "";
    elements.editTeacherDomain.value = teacher.domain || "";
    elements.editTeacherEmail.value = teacher.email || "";

    editModal.show();
};

window.toggleTeacherStatus = async (teacherId, shouldSuspend) => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (!teacher) return;

    const action = shouldSuspend ? "suspend" : "activate";
    const confirmMsg = `Are you sure you want to ${action} "${teacher.name}"?`;

    if (!confirm(confirmMsg)) return;

    try {
        await updateDoc(doc(db, "users", teacherId), {
            active: !shouldSuspend
        });

        await logAction(`admin_${action}_teacher`, {
            teacherId,
            teacherName: teacher.name
        });

        showStatus(`✅ Teacher ${shouldSuspend ? 'suspended' : 'activated'} successfully!`);

    } catch (error) {
        console.error("Toggle status error:", error);
        showStatus(`❌ ${error.message}`, true);
    }
};

window.deleteTeacher = async (teacherId) => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (!teacher) return;

    const confirmMsg = `⚠️ DELETE TEACHER: "${teacher.name}"\n\n` +
        `This will:\n` +
        `• Remove their account permanently\n` +
        `• Cancel all their appointments\n` +
        `• Delete all their messages\n\n` +
        `Type "DELETE" to confirm:`;

    const userInput = prompt(confirmMsg);
    if (userInput !== "DELETE") return;

    try {
        // Cancel appointments
        const appointmentsQuery = query(collection(db, "appointments"), where("teacherId", "==", teacherId));
        const appointmentsSnap = await getDocs(appointmentsQuery);

        for (const docSnap of appointmentsSnap.docs) {
            await updateDoc(doc(db, "appointments", docSnap.id), {
                status: "cancelled",
                cancelledReason: "teacher_deleted",
                cancelledAt: serverTimestamp()
            });
        }

        // Delete conversations
        const conversationsQuery = query(collection(db, "conversations"), where("teacherId", "==", teacherId));
        const conversationsSnap = await getDocs(conversationsQuery);

        for (const docSnap of conversationsSnap.docs) {
            await deleteDoc(doc(db, "conversations", docSnap.id));
        }

        // Delete user document
        await deleteDoc(doc(db, "users", teacherId));

        await logAction("admin_delete_teacher", {
            teacherId,
            teacherName: teacher.name,
            teacherEmail: teacher.email
        });

        showStatus(`✅ Teacher "${teacher.name}" deleted successfully!`);

    } catch (error) {
        console.error("Delete teacher error:", error);
        showStatus(`❌ ${error.message}`, true);
    }
};

window.approveStudent = async (studentId) => {
    try {
        await updateDoc(doc(db, "users", studentId), {
            active: true,
            approvedAt: serverTimestamp()
        });

        await logAction("admin_approve_student", { studentId });
        showStatus("✅ Student approved successfully!");

    } catch (error) {
        console.error("Approve student error:", error);
        showStatus(`❌ ${error.message}`, true);
    }
};

window.rejectStudent = async (studentId) => {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    if (!confirm(`Reject and delete student "${student.name || student.email}"?`)) return;

    try {
        await deleteDoc(doc(db, "users", studentId));
        await logAction("admin_reject_student", {
            studentId,
            studentEmail: student.email
        });

        showStatus("⛔ Student rejected and deleted.");

    } catch (error) {
        console.error("Reject student error:", error);
        showStatus(`❌ ${error.message}`, true);
    }
};

window.deleteStudent = async (studentId) => {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    if (!confirm(`Delete student "${student.name || student.email}"? This cannot be undone.`)) return;

    try {
        // Cancel their appointments
        const appointmentsQuery = query(collection(db, "appointments"), where("studentId", "==", studentId));
        const appointmentsSnap = await getDocs(appointmentsQuery);

        for (const docSnap of appointmentsSnap.docs) {
            await updateDoc(doc(db, "appointments", docSnap.id), {
                status: "cancelled",
                cancelledReason: "student_deleted",
                cancelledAt: serverTimestamp()
            });
        }

        // Delete user document
        await deleteDoc(doc(db, "users", studentId));

        await logAction("admin_delete_student", {
            studentId,
            studentName: student.name,
            studentEmail: student.email
        });

        showStatus(`✅ Student "${student.name || student.email}" deleted successfully!`);

    } catch (error) {
        console.error("Delete student error:", error);
        showStatus(`❌ ${error.message}`, true);
    }
};