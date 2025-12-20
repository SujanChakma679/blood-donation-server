const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster33.pzhkenb.mongodb.net/?appName=Cluster33`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("blood_donation_DB");
    const usersCollection = db.collection("users");
    const donationRequestsCollection = db.collection("donationRequests");

    /* ================= USERS ================= */

    // Create user
    app.post("/users", async (req, res) => {
      const userInfo = req.body;

      userInfo.role = "donor";
      userInfo.status = "active";
      userInfo.createdAt = new Date();

      const result = await usersCollection.insertOne(userInfo);
      res.send(result);
    });

    // Get user role by email
    app.get("/users/role/:email", async (req, res) => {
      const { email } = req.params;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    // Get all users
    app.get("/users", async (req, res) => {
      const status = req.query.status;
      const query = status ? { status } : {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    /* ===== Toggle Block / Unblock (ObjectId OR string id) ===== */
    app.patch("/users/status/:id", async (req, res) => {
      const { id } = req.params;

      let query;

      // check if valid ObjectId
      if (ObjectId.isValid(id)) {
        query = { _id: new ObjectId(id) };
      } else {
        query = { _id: id }; // fallback (string id)
      }

      const user = await usersCollection.findOne(query);

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      const newStatus = user.status === "active" ? "blocked" : "active";

      await usersCollection.updateOne(query, {
        $set: { status: newStatus },
      });

      res.send({ status: newStatus });
    });

    /* ===== Change Role (ObjectId OR string id) ===== */
    app.patch("/users/role/:id", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      let filter;

      if (ObjectId.isValid(id)) {
        filter = { _id: new ObjectId(id) };
      } else {
        filter = { _id: id };
      }

      const result = await usersCollection.updateOne(filter, {
        $set: { role },
      });

      res.send(result);
    });

    /* ================= DONATION REQUESTS ================= */

    // Create donation request (blocked users forbidden)
    app.post("/donation-requests", async (req, res) => {
      const donationRequest = req.body;
      const email = donationRequest.requesterEmail;

      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      if (user.status === "blocked") {
        return res.status(403).send({
          message: "Blocked users cannot create donation requests",
        });
      }

      donationRequest.createdAt = new Date();
      donationRequest.donationStatus = "pending";

      const result = await donationRequestsCollection.insertOne(
        donationRequest
      );
      res.send(result);
    });

    // Get donation requests by email
    app.get("/donation-requests", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const result = await donationRequestsCollection
        .find({ requesterEmail: email })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    /* ================= ADMIN DASHBOARD ================= */

    app.get("/admin-stats", async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments({
          role: "donor",
        });

        const totalRequests = await donationRequestsCollection.countDocuments();

        res.send({
          totalUsers,
          totalRequests,
          totalFunds: 0,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load admin stats" });
      }
    });

    app.get("/donation-requests/all", async (req, res) => {
      const result = await donationRequestsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    console.log("MongoDB connected successfully");
  } finally {
    // keep connection alive
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
