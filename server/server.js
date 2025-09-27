// ---------------------------------------------------------------
// server/server.js
// ---------------------------------------------------------------

const express   = require('express');
const axios     = require('axios');
const mongoose  = require('mongoose');
const bodyParser= require('body-parser');
const https     = require('https');
const WebSocket = require('ws');

const app = express();
app.use(bodyParser.json());

/* --------------------------------------------------------------
   1️⃣  MONGOOSE CONNECTION
   -------------------------------------------------------------- */
// Use the URI that the test‑setup (mongodb‑memory‑server) puts into
// `process.env.MONGO_URI`.  If that variable is not set we fall back
// to the normal development URI.
const devUri   = 'mongodb://localhost:27017/myDatabase';
const mongoUri = process.env.MONGO_URI || devUri;

mongoose
  .connect(mongoUri)               // Mongoose 7+ ignores the old options
  .catch(err => console.error('Mongo connection error:', err));

/* --------------------------------------------------------------
   2️⃣  Mongoose model – make name & email required so validation
       errors are exercised in the tests.
   -------------------------------------------------------------- */
const User = mongoose.model('loginCredentials', {
  name:  { type: String, required: true },
  email: { type: String, required: true },
  linkedinId: String,
  googleId:   String,
});

/* --------------------------------------------------------------
   3️⃣  OAuth client IDs / secrets (place‑holders)
   -------------------------------------------------------------- */
const linkedinClientId     = '<linkedin-client-id>';
const linkedinClientSecret = '<linkedin-client-secret>';
const googleClientId       = '<google-client-id>';
const googleClientSecret   = '<google-client-secret>';

const linkedinRedirectUrl = '<linkedin-redirect-url>';
const googleRedirectUrl   = '<google-redirect-url>';

/* --------------------------------------------------------------
   4️⃣  HTTPS agent – keep as‑is (self‑signed certs)
   -------------------------------------------------------------- */
axios.defaults.httpsAgent = new https.Agent({ rejectUnauthorized: false });

/* --------------------------------------------------------------
   5️⃣  WebSocket server – always start it.
       In test mode we listen on a random free port (0) so it never
       collides with a real server that might be listening on 8080.
   -------------------------------------------------------------- */
const wsPort = process.env.NODE_ENV === 'test' ? 0 : 8080;
const wss = new WebSocket.Server({ port: wsPort });

wss.on('connection', ws => {
  console.log('Client connected');

  ws.on('message', message => {
    console.log(`Received message => ${message}`);
    // broadcast to every other client
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => console.log('Client disconnected'));
});

/* --------------------------------------------------------------
   6️⃣  REST API routes (unchanged logic)
   -------------------------------------------------------------- */
app.get('/api/users', (req, res) => {
  User.find()
    .then(users => res.status(200).json(users))
    .catch(err => {
      console.error(err);
      res.status(500).json({ message: 'Error fetching users' });
    });
});

app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  const user = new User({ name, email });
  user.save()
    .then(() => res.status(201).json(user))
    .catch(err => {
      console.error(err);
      res.status(500).json({ message: 'Error creating user' });
    });
});

app.put('/api/users/:id', (req, res) => {
  const { name, email } = req.body;
  User.findByIdAndUpdate(req.params.id, { name, email }, { new: true })
    .then(user => {
      if (!user) {
        // No document with that _id
        return res.status(404).json({ message: 'User not found' });
      }
      res.status(200).json(user);
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({ message: 'Error updating user' });
    });
});

app.delete('/api/users/:id', (req, res) => {
  User.findByIdAndDelete(req.params.id)
    .then(user => {
      if (!user) {
        // Nothing was deleted
        return res.status(404).json({ message: 'User not found' });
      }
      res.status(200).json({ message: 'User deleted successfully' });
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({ message: 'Error deleting user' });
    });
});

/* --------------------------------------------------------------
   7️⃣  OAuth redirect endpoints (unchanged)
   -------------------------------------------------------------- */
app.get('/auth/linkedin', (req, res) => {
  const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${linkedinClientId}&redirect_uri=${linkedinRedirectUrl}&state=foobar&scope=liteprofile%20emailaddress%20w_member_social`;
  res.redirect(url);
});

app.get('/auth/linkedin/callback', (req, res) => {
  const code = req.query.code;

  axios.post('https://www.linkedin.com/oauth/v2/accessToken', {
    grant_type: 'authorization_code',
    code,
    client_id: linkedinClientId,
    client_secret: linkedinClientSecret,
    redirect_uri: linkedinRedirectUrl,
  })
    .then(r => r.data.access_token)
    .then(token => axios.get('https://api.linkedin.com/v2/me', {
      headers: { Authorization: `Bearer ${token}` },
    }))
    .then(r => {
      const p = r.data;
      const user = new User({
        name: `${p.firstName} ${p.lastName}`,
        email: p.emailAddress,
        linkedinId: p.id,
      });
      return user.save();
    })
    .then(() => res.redirect('/?code=linkedin'))
    .catch(err => {
      console.error(err);
      res.status(500).json({ message: 'Error logging in with LinkedIn' });
    });
});

app.get('/auth/google', (req, res) => {
  const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${googleClientId}&redirect_uri=${googleRedirectUrl}&scope=profile%20email`;
  res.redirect(url);
});

app.get('/auth/google/callback', (req, res) => {
  const code = req.query.code;

  axios.post('https://oauth2.googleapis.com/token', {
    grant_type: 'authorization_code',
    code,
    client_id: googleClientId,
    client_secret: googleClientSecret,
    redirect_uri: googleRedirectUrl,
  })
    .then(r => r.data.access_token)
    .then(token => axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    }))
    .then(r => {
      const p = r.data;
      const user = new User({
        name: p.name,
        email: p.email,
        googleId: p.sub,
      });
      return user.save();
    })
    .then(() => res.redirect('/?code=google'))
    .catch(err => {
      console.error(err);
      res.status(500).json({ message: 'Error logging in with Google' });
    });
});

/* --------------------------------------------------------------
   8️⃣  Serve static front‑end files
   -------------------------------------------------------------- */
app.use(express.static('public'));

/* --------------------------------------------------------------
   9️⃣  Export for the test runner
   -------------------------------------------------------------- */
module.exports = { app, wss };

/* --------------------------------------------------------------
   🔟  Start the HTTP server only when the file is executed directly
   -------------------------------------------------------------- */
const PORT = 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
