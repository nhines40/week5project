# Social Media Login

## Prerequisites

Node.js
MongoDB
LinkedIn Developer account
Google Developer account

## Setup

1. Clone this repository
2. Install the dependencies using `npm install <dependency>`
3. Create a new MongoDB database and add the connection string to the mongoose.connect() function in server.js
4. Create a new LinkedIn Developer account and add the client ID and client secret to the linkedinClientId and linkedinClientSecret variables in server.js and app.js
5. Create a new Google Developer account and add the client ID and client secret to the googleClientId and googleClientSecret variables in server.js and app.js

## Transpiler
Whenever the code in `public/app.js` is updated the code need to be transpiled running the command `npx esbuild public/app.js --bundle --outfile=public/app-transpiled.js` and the resulting code in `public/app-transpiled.js` will be ran as the app

## Configuring Social Media Login

LinkedIn:
1. Go to the LinkedIn Developer dashboard and create a new application
2. Add the authorized redirect URI (`http://localhost:3000/auth/linkedin/callback`) to the application settings
3. Get the client ID and client secret

Google:
1. Go to the Google Developer dashboard and create a new project
2. Add the authorized redirect URI (`http://localhost:3000/auth/google/callback`) to the credentials settings
3. Get the client ID and client secret

## Running the Project

1. Start your MongoDB server either in the MongoDB Compass UI or on the command line
2. Start the server by running `npm start`
3. Open a web browser and go to `http://localhost:3000`

## Troubleshooting Guides

1. Connecting to MongoDB: Double heck the MongoDB connection string and ensure that the database is running/connected.
2. Error with social media login: Double check the client ID and client secret for the social media platform and ensure that the authorized redirect URI is correcttly configured.