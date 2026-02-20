const express = require("express");
const schedule = require("node-schedule");
const cors = require("cors");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 5000;

const SECRET = "supersecretkey";

// ---------------- EMAIL SETUP ----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "ziyan.fur@gmail.com",      // 🔁 CHANGE
    pass: " bvlj hlmi qnyk uiip"         // 🔁 CHANGE
  }
});

// ---------------- REAL-TIME CLIENTS ----------------
let clients = [];

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clients.push(res);

  req.on("close", () => {
    clients = clients.filter(client => client !== res);
  });
});

// ---------------- USERS ----------------
let users = fs.existsSync("users.json")
  ? JSON.parse(fs.readFileSync("users.json"))
  : [];

function saveUsers() {
  fs.writeFileSync("users.json", JSON.stringify(users, null, 2));
}

// ---------------- REMINDERS ----------------
let reminders = fs.existsSync("reminders.json")
  ? JSON.parse(fs.readFileSync("reminders.json"))
  : [];

function saveReminders() {
  fs.writeFileSync("reminders.json", JSON.stringify(reminders, null, 2));
}

// ---------------- COMPLETED ----------------
let completed = fs.existsSync("completed.json")
  ? JSON.parse(fs.readFileSync("completed.json"))
  : [];

function saveCompleted() {
  fs.writeFileSync("completed.json", JSON.stringify(completed, null, 2));
}

// ---------------- AUTH ----------------
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "No token" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

// ---------------- SCHEDULER ----------------
function scheduleReminder(reminder) {
  const reminderDate = new Date(reminder.dateTime + ":00");
  if (reminderDate <= new Date()) return;

  schedule.scheduleJob(reminder.id, reminderDate, async () => {
    try {
      await transporter.sendMail({
        from: "ziyan.fur@gmail.com",
        to: "ziyan.fur@gmail.com",
        subject: `Reminder: ${reminder.title}`,
        html: `
          <h2>Reminder Notification</h2>
          <p><strong>${reminder.title}</strong></p>
          <p>${reminder.description}</p>
          <p>${reminder.dateTime}</p>
        `
      });

      console.log("Reminder triggered:", reminder.title);

      // Move to completed
      completed.push({
        ...reminder,
        completedAt: new Date().toISOString()
      });
      saveCompleted();

      // Remove from active reminders
      reminders = reminders.filter(r => r.id !== reminder.id);
      saveReminders();

      // 🔥 Notify clients
      clients.forEach(client =>
        client.write(`data: ${JSON.stringify({
          type: "REMINDER_TRIGGERED",
          title: reminder.title
        })}\n\n`)
      );

    } catch (err) {
      console.log("Email error:", err);
    }
  });
}

reminders.forEach(r => scheduleReminder(r));

// ---------------- REGISTER ----------------
app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  const existing = users.find(u => u.username === username);
  if (existing) return res.status(400).json({ message: "User exists" });

  const hashed = await bcrypt.hash(password, 10);
  users.push({ id: Date.now().toString(), username, password: hashed });
  saveUsers();

  res.json({ message: "Registered successfully" });
});

// ---------------- LOGIN ----------------
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ message: "User not found" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ message: "Wrong password" });

  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "1d" });
  res.json({ token });
});

// ---------------- PROFILE ----------------
app.get("/profile", authenticate, (req, res) => {
  const user = users.find(u => u.id === req.userId);
  res.json({ username: user.username });
});

// ---------------- ADD REMINDER ----------------
app.post("/send-reminder", authenticate, (req, res) => {
  const { title, description, date, time } = req.body;

  const newReminder = {
    id: Date.now().toString(),
    userId: req.userId,
    title,
    description,
    dateTime: `${date}T${time}`
  };

  reminders.push(newReminder);
  saveReminders();
  scheduleReminder(newReminder);

  res.json({ message: "Scheduled successfully" });
});

// ---------------- GET ----------------
app.get("/reminders", authenticate, (req, res) => {
  res.json(reminders.filter(r => r.userId === req.userId));
});

app.get("/completed", authenticate, (req, res) => {
  res.json(completed.filter(c => c.userId === req.userId));
});

// ---------------- START ----------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "auth.html"));
});
app.get("/admin/users", (req, res) => {
  const safeUsers = users.map(u => ({
    id: u.id,
    username: u.username
  }));

  res.json(safeUsers);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

