const express = require("express");
const cors = require("cors");
require ('dotenv').config();


const app = express();
const port = process.env.PORT || 3000;


// middleware
app.use(cors());
app.use(express.json());



const { MongoClient, ServerApiVersion } = require('mongodb');


const uri =
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster33.pzhkenb.mongodb.net/?appName=Cluster33`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {

    
    

    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("blood_donation_DB");
    const usersCollection = db.collection("users");
    const donationRequestsCollection = db.collection("donationRequests");


    app.post('/users', async(req, res) =>{
      const userInfo = req.body;
      
      userInfo.role = 'donor'; // we can set role default from the backed also
      userInfo.status = 'active';
      userInfo.createdAt = new Date();
      const result = await usersCollection.insertOne(userInfo);
      res.send(result)
    })

    // user role api
    app.get('/users/role/:email', async(req, res) =>{
      const {email} = req.params
      const query = { email: email }
      const result = await usersCollection.findOne(query)
      console.log(result)
      res.send(result)
    })

    // donation request api
    app.post("/donation-requests", async (req, res) => {
  const donationRequest = req.body;

  donationRequest.createdAt = new Date();
  donationRequest.donationStatus = "pending";

  const result = await donationRequestsCollection.insertOne(donationRequest);
  res.send(result);
});

app.get("/donation-requests", async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).send({ message: "Email is required" });
  }

  const query = { requesterEmail: email };
  const result = await donationRequestsCollection
    .find(query)
    .sort({ createdAt: -1 }) // newest first
    .toArray();

  res.send(result);
});


// app.get("/donation-requests/recent", async (req, res) => {
//   const email = req.query.email;

//   const result = await donationRequestsCollection
//     .find({ requesterEmail: email })
//     .sort({ createdAt: -1 })
//     .limit(3)
//     .toArray();

//   res.send(result);
// });









    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) =>{
    res.send("Hello, this is Backend!")
})

app.listen(port, () => {
  console.log(`Smart server is running on port: ${port}`);
});
