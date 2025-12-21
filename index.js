



const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());

/* ================= MONGODB ================= */
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
    console.log("✅ MongoDB connected");

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

    // Toggle block / unblock
    app.patch("/users/status/:id", async (req, res) => {
      const { id } = req.params;

      const filter = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { _id: id };

      const user = await usersCollection.findOne(filter);

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      const newStatus = user.status === "active" ? "blocked" : "active";

      await usersCollection.updateOne(filter, {
        $set: { status: newStatus },
      });

      res.send({ status: newStatus });
    });

    // Change role
    app.patch("/users/role/:id", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      const filter = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { _id: id };

      const result = await usersCollection.updateOne(filter, {
        $set: { role },
      });

      res.send(result);
    });

    /* ================= DONATION REQUESTS ================= */

    // PUBLIC: Get all pending donation requests
    app.get("/donation-requests/pending", async (req, res) => {
      const result = await donationRequestsCollection
        .find({ donationStatus: "pending" })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    // Create donation request
    app.post("/donation-requests", async (req, res) => {
      const donationRequest = req.body;

      const user = await usersCollection.findOne({
        email: donationRequest.requesterEmail,
      });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      if (user.status === "blocked") {
        return res
          .status(403)
          .send({ message: "Blocked users cannot create requests" });
      }

      donationRequest.createdAt = new Date();
      donationRequest.donationStatus = "pending";

      const result = await donationRequestsCollection.insertOne(
        donationRequest
      );

      res.send(result);
    });

    // Get requests by requester email
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

    // Get single donation request (private)
    app.get("/donation-requests/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid request ID" });
      }

      const request = await donationRequestsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!request) {
        return res.status(404).send({ message: "Request not found" });
      }

      res.send(request);
    });

    // DELETE donation request (only pending + owner)
    app.delete("/donation-requests/:id", async (req, res) => {
      const { id } = req.params;
      const email = req.query.email;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid ID" });
      }

      const request = await donationRequestsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!request) {
        return res.status(404).send({ message: "Not found" });
      }

      if (request.donationStatus !== "pending") {
        return res
          .status(400)
          .send({ message: "Only pending requests can be deleted" });
      }

      if (request.requesterEmail !== email) {
        return res.status(403).send({ message: "Not allowed" });
      }

      await donationRequestsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send({ success: true });
    });

    // DONATE (pending → inprogress)
    app.patch("/donation-requests/:id/donate", async (req, res) => {
      const { id } = req.params;
      const { donorName, donorEmail } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid request ID" });
      }

      const user = await usersCollection.findOne({ email: donorEmail });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      if (user.status === "blocked") {
        return res
          .status(403)
          .send({ message: "Blocked users cannot donate" });
      }

      const result = await donationRequestsCollection.updateOne(
        {
          _id: new ObjectId(id),
          donationStatus: "pending",
        },
        {
          $set: {
            donorName,
            donorEmail,
            donationStatus: "inprogress",
          },
        }
      );

      if (result.modifiedCount === 0) {
        return res
          .status(400)
          .send({ message: "Donation already taken" });
      }

      res.send(result);
    });

    // Donor updates status (done / canceled)
    app.patch("/donation-requests/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;

      if (!["done", "canceled"].includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }

      const request = await donationRequestsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!request) {
        return res.status(404).send({ message: "Not found" });
      }

      if (request.donationStatus !== "inprogress") {
        return res
          .status(400)
          .send({ message: "Status change not allowed" });
      }

      if (request.donorEmail !== email) {
        return res.status(403).send({ message: "Not allowed" });
      }

      await donationRequestsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            donationStatus: status,
            completedAt: new Date(),
          },
        }
      );

      res.send({ success: true });
    });


    // SEARCH DONORS (PUBLIC)
app.get("/users/search", async (req, res) => {
  const { bloodGroup, district, upazila } = req.query;

  // Build dynamic query
  const query = {
    role: "donor",
    status: "active",
  };

  if (bloodGroup) query.bloodGroup = bloodGroup;
  if (district) query.district = district;
  if (upazila) query.upazila = upazila;

  const donors = await usersCollection.find(query).toArray();

  res.send(donors);
});


    /* ================= ADMIN STATS ================= */

    app.get("/admin-stats", async (req, res) => {
      const totalUsers = await usersCollection.countDocuments({
        role: "donor",
      });

      const totalRequests =
        await donationRequestsCollection.countDocuments();

      res.send({
        totalUsers,
        totalRequests,
        totalFunds: 0,
      });
    });
  } catch (error) {
    console.error("Server error:", error);
  }
}

run();

/* ================= ROOT ================= */
app.get("/", (req, res) => {
  res.send("Backend is running ");
});

app.listen(port, () => {
  console.log(` Server running on port ${port}`);
});
