//jshint esversion:6

import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import ejs from "ejs";
import mongoose from "mongoose";
import session from "express-session";
import passport from "passport";
import PassportLocalMongoose from "passport-local-mongoose";
import findOrCreate from "mongoose-findorcreate";
import nodemailer from "nodemailer";

const app = express();
dotenv.config();

app.use(express.static("public"));
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: "iamrohit",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

const mongo_url = process.env.MONGO_API_KEY;
mongoose.connect(mongo_url);

const userSchema = new mongoose.Schema({
  email: String,
  username: String,
  password: String,
  lat: String,
  long: String,
  time: String,
  isSubscribed: Boolean,
});

userSchema.plugin(PassportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = new mongoose.model("User", userSchema);

passport.use(User.createStrategy());

passport.serializeUser(User.serializeUser());

passport.deserializeUser(User.deserializeUser());

const mq135threshold = 750;
const mq3threshold = 1500;
const maxDistance = 3;
const maxTime = 6;

function calculateDistance(lat1Str, lon1Str, lat2Str, lon2Str) {
  // Convert input strings to floating-point numbers
  const lat1 = parseFloat(lat1Str);
  const lon1 = parseFloat(lon1Str);
  const lat2 = parseFloat(lat2Str);
  const lon2 = parseFloat(lon2Str);

  const R = 6371; // Radius of the Earth in kilometers

  // Convert latitude and longitude from degrees to radians
  const radLat1 = (Math.PI * lat1) / 180;
  const radLon1 = (Math.PI * lon1) / 180;
  const radLat2 = (Math.PI * lat2) / 180;
  const radLon2 = (Math.PI * lon2) / 180;

  // Haversine formula
  const dLat = radLat2 - radLat1;
  const dLon = radLon2 - radLon1;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) *
      Math.cos(radLat2) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in kilometers

  return distance;
}

let transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass:  process.env.GMAIL_PASSWORD,
    // ⚠️ Use environment variables set on the server for these values when deploying
  },
});

// Fetch the data from the API
// Replace this with your actual API endpoint and logic
const fetchDataFromAPI = () => {
  const apiUrl = process.env.Api_URL;

  // Make a GET request to the API
  fetch(apiUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      const mq135data = data.field1;
      const mq3data = data.field2;

      console.log("api data: " + mq135data + ", " + mq3data);

      // Call the function to send alerts
      if (mq135data > mq135threshold && mq3data > mq3threshold) {
        sendAlertToSubscribedUsers(mq135data);
        sendAlertToSubscribedUsers(data);
      } else if (mq135data > mq135threshold) {
        sendAlertToSubscribedUsers(data);
      } else if (mq3data > mq3threshold) {
        sendAlertToSubscribedUsers(data);
      }
    })
    .catch((error) => {
      console.error("Error:", error);
    });
};

// Send an alert to subscribed users via email
const sendAlertToSubscribedUsers = async (data) => {
  try {
    const admin = await User.findOne({ username: "Admin@gmail.com" });
    const users = await User.find({ isSubscribed: true }).exec();
    const adminTimestamp = new Date(admin.time);
    console.log("admin co-ord: " + admin.lat + " " + admin.long);
    users.forEach((user) => {
      if (user.email && user.lat && user.long && user.time) {
        console.log("user cordinate: " + user.lat + " " + user.long);
        const userTimestamp = new Date(user.time);
        let diffDistance = calculateDistance(
          admin.lat,
          admin.long,
          user.lat,
          user.long
        );
        const timeDifference = Math.abs(userTimestamp - adminTimestamp);
        console.log("time difference: " + timeDifference / 1000 + "s");
        const minutesDifference = (timeDifference / (1000 * 60)).toFixed(2);

        console.log("distance between: " + diffDistance);
        if (diffDistance < maxDistance && minutesDifference < maxTime) {
          if (diffDistance == 0) diffDistance = 1;
          const emailContent = `
            <h1>Air Quality Alert</h1>
            <p>AQI (${data.field1}) and MQ3(${data.field2}) levels around you within ${diffDistance}km, within ${minutesDifference}minutes</p>
            <p>Air Pollution exceeds the threshold. Please take necessary precautions.</p>
          `;
          // sendEmail(user.email, "Air Quality Alert", emailContent);
        }
      } else {
        console.warn(
          `Skipping user due to missing or invalid email address: ${user._id}`
        );
      }
    });
  } catch (err) {
    console.error("Error fetching subscribed users:", err);
  }
};

// Send an email
const sendEmail = (to, subject, text) => {
  if (!to) {
    console.warn("Skipping sending email due to missing or invalid recipient.");
    return;
  }

  const mailOptions = {
    from: "Air Pro <AirPro@gmail.com>",
    to,
    subject,
    html: text, // Use HTML for email content
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
    } else {
      console.log("Email sent:", info.messageId);
    }
  });
};

// Fetch data periodically (e.g., every hour)
setInterval(fetchDataFromAPI, 120000); // Adjust the interval as needed

// You can start the initial data fetch as well
fetchDataFromAPI();

app.get("/", (req, res) => {
  res.render("landing");
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.get("/home", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("home");
  } else {
    res.render("login");
  }
});

app.post("/save-location", (req, res) => {
  // Ensure the user is authenticated
  if (req.isAuthenticated() && req.user) {
    const { latitude, longitude } = req.body; // Extract the location data from the form submission
    const timestamp = new Date(); // Get the current timestamp
    // Update the user's location in the database (assuming you have a "User" model defined)
    User.findByIdAndUpdate(req.user._id, {
      lat: latitude,
      long: longitude,
      time: timestamp,
    })
      .then((user) => {
        if (user) {
          console.log("User location updated successfully:", user);
          res.redirect("/home"); // Redirect to the home page or a success page
        } else {
          // Handle the case where the user with the given ID is not found
          res.status(404).send("User not found");
        }
      })
      .catch((err) => {
        console.error("Error updating user location:", err);
        res.status(500).send("Internal Server Error");
      });
  } else {
    // Handle unauthenticated requests
    res.status(401).send("Unauthorized");
  }
});

app.get("/logout", function (req, res) {
  req.logout((err) => {
    console.log(err);
  });
  res.redirect("/");
});

app.post("/register", async (req, res) => {
  const { username, password, subscribe } = req.body; // Extract the "subscribe" field from the request body

  try {
    const user = new User({ username });
    await user.setPassword(password);

    // Check if the "subscribe" checkbox is checked
    const isSubscribed = subscribe === "on";

    // Set the subscription status in the user document
    user.isSubscribed = isSubscribed;
    user.email = username;

    await user.save();

    passport.authenticate("local")(req, res, () => {
      res.redirect("/home");
    });
  } catch (err) {
    console.error(err);
    return res.redirect("/register");
  }
});

app.post("/login", (req, res) => {
  if (req.body.username === "" || req.body.password === "") {
    return res.redirect("/login");
  }

  const user = new User({
    username: req.body.username,
    password: req.body.password,
  });

  req.login(user, (err) => {
    if (err) {
      console.log(err);
      return res.redirect("/login");
    }

    passport.authenticate("local", (err, user) => {
      if (err) {
        console.log(err);
        return res.redirect("/login");
      }

      // Check if the "subscribe" checkbox is checked during login
      const isSubscribed = req.body.subscribe === "on";
      if (isSubscribed == true) {
        User.updateOne({ email: req.body.username }, { isSubscribed: true })
          .then((result) => {
            console.log("User updated successfully:", result);
          })
          .catch((err) => {
            console.error("Error updating user:", err);
          });
      }
      return res.redirect("/home");
    })(req, res);
  });
});

app.listen(3000, () => {
  console.log("Server is running");
});
