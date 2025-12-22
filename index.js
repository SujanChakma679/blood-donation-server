const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

const stripe = require("stripe")(process.env.STRIPE_PAYMENT_GATEWAY);
const crypto = require("crypto");

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
    const donationsCollection = db.collection("donor");

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

    //--------------- Payment Gateway-----------------

    app.post("/create-payment", async (req, res) => {
      try {
        const { donationAmount, name, email } = req.body;

        if (typeof donationAmount !== "number" || donationAmount <= 0) {
          return res.status(400).json({
            success: false,
            message: "Invalid donation amount",
          });
        }

        const amountInCents = donationAmount * 100;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amountInCents,
                product_data: {
                  name: "Blood Donation Support",
                },
              },
              quantity: 1,
            },
          ],
          customer_email: email,
          metadata: {
            donorName: name,
          },
          success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel`,
        });

        res.status(200).json({
          success: true,
          url: session.url,
        });
      } catch (error) {
        console.error("Stripe Error:", error);
        res.status(500).json({
          success: false,
          message: "Internal Server Error",
        });
      }
    });

    app.post("/confirm-payment", async (req, res) => {
      try {
        const { sessionId } = req.body;

        if (!sessionId) {
          return res.status(400).json({ message: "Session ID missing" });
        }

        // 1️⃣ Retrieve session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // 2️⃣ Check payment status
        if (session.payment_status !== "paid") {
          return res.status(400).json({ message: "Payment not completed" });
        }

        // 3️⃣ Prepare donation data
        const donation = {
          name: session.metadata?.donorName || "Anonymous",
          email: session.customer_email,
          amount: session.amount_total / 100,
          currency: session.currency,
          transactionId: session.payment_intent,
          sessionId: session.id,
          createdAt: new Date(),
        };

        // 4️⃣ Save to database (MongoDB example)
        const result = await donationsCollection.insertOne(donation);

        res.status(200).json({
          success: true,
          message: "Donation saved successfully",
          donationId: result.insertedId,
        });
      } catch (error) {
        console.error("Confirm payment error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // all financial donation data
   app.get("/donations", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 🔐 Get user role from DB
    const user = await usersCollection.findOne({ email });

    // ✅ Admin → full access
    if (user?.role === "admin") {
      const donations = await donationsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      return res.json(donations);
    }

    // 🔍 Financial donor check
    const hasDonated = await donationsCollection.findOne({ email });

    if (!hasDonated) {
      return res.status(403).json({
        message: "You have not made any financial donation",
      });
    }

    // ✅ Financial donor → see all
    const donations = await donationsCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.json(donations);

  } catch (error) {
    console.error("Donations fetch error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


app.get("/donations-access", async (req, res) => {
  const { email } = req.query;

  if (!email) return res.json({ allowed: false });

  const user = await usersCollection.findOne({ email });

  if (user?.role === "admin") {
    return res.json({ allowed: true });
  }

  const hasDonated = await donationsCollection.findOne({ email });

  res.json({ allowed: !!hasDonated });
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

    // ADMIN: Get all donation requests
    app.get("/donation-requests/all", async (req, res) => {
      const result = await donationRequestsCollection
        .find({})
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

    // change the status
    app.patch("/donation-requests/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status, email, role } = req.body;

      if (!["done", "canceled"].includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }

      const request = await donationRequestsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!request) {
        return res.status(404).send({ message: "Not found" });
      }

      // ✅ ADMIN OVERRIDE
      if (role !== "admin") {
        if (request.donationStatus !== "inprogress") {
          return res.status(400).send({ message: "Status change not allowed" });
        }

        if (request.donorEmail !== email) {
          return res.status(403).send({ message: "Not allowed" });
        }
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
        return res.status(403).send({ message: "Blocked users cannot donate" });
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
        return res.status(400).send({ message: "Donation already taken" });
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
        return res.status(400).send({ message: "Status change not allowed" });
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

      const totalRequests = await donationRequestsCollection.countDocuments();

      // 🔥 Calculate total funds
      const fundsResult = await donationsCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalFunds: { $sum: "$amount" },
            },
          },
        ])
        .toArray();

      const totalFunds = fundsResult[0]?.totalFunds || 0;

      res.send({
        totalUsers,
        totalRequests,
        totalFunds,
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
