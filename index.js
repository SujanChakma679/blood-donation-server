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

    app.post('/users', async(req, res) =>{
      const userInfo = req.body;
      userInfo.role = 'donor';
      userInfo.createdAt = new Date();

      const result = await usersCollection.insertOne(userInfo);

      res.send(result)
    })








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
