// ---------------------------------------------------------------
// server/test/server.test.js
// ---------------------------------------------------------------

/* -------------- Imports -------------------------------------- */
const http = require('http');
const request = require('supertest');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

/* -------------- In‑memory MongoDB (or real DB) -------------- */
let mongoServer;
let app;      // Express app exported from server.js
let wss;      // WebSocket server exported from server.js

beforeAll(async () => {
  /* --------------------------------------------------------------
     1️⃣  Spin up an in‑memory MongoDB instance (or connect to a real one)
         – If you already have a real MongoDB running and want to use it,
           comment‑out the `MongoMemoryServer` lines and set
           `process.env.MONGO_URI` to your real URI before running the tests.
     -------------------------------------------------------------- */
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  // Make the URI visible to server.js (it reads process.env.MONGO_URI)
  process.env.MONGO_URI = uri;

  // Connect Mongoose *once* – server.js will reuse this connection.
  await mongoose.connect(uri);

  /* --------------------------------------------------------------
     2️⃣  **Clear the collection** – ensures a pristine DB for every run.
         This is the line you asked about.
     -------------------------------------------------------------- */
  await mongoose.connection.collection('logincredentials').deleteMany({});

  // 3️⃣  Now require the server (it will see process.env.MONGO_URI)
  const serverModule = require('../server');   // <-- relative to this file
  app = serverModule.app;
  wss = serverModule.wss;
});

afterAll(async () => {
  // Clean up Mongoose and the in‑memory server
  await mongoose.disconnect();
  await mongoServer.stop();
});

/* --------------------------------------------------------------
   Start/stop the HTTP server (Express) – one per suite.
   -------------------------------------------------------------- */
let httpServer;
beforeAll((done) => {
  httpServer = http.createServer(app);
  httpServer.listen(0, done);   // random free port
});

afterAll((done) => {
  // Close the WS server first (it may still have clients)
  wss.close(() => {
    httpServer.close(done);
  });
});

/* -------------------------------------------------------------
   USER CRUD API TESTS (21 total)
   ------------------------------------------------------------- */
describe('User CRUD API', () => {
  let createdId;          // id of the first user we create
  let secondUserId;       // id of the duplicate‑email user (used later)

  /* ---------- Happy‑path tests (1‑6) ---------- */
  test('GET /api/users – empty DB', async () => {
    const res = await request(httpServer).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('POST /api/users – happy path', async () => {
    const payload = { name: 'Alice', email: 'alice@example.com' };
    const res = await request(httpServer).post('/api/users').send(payload);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(payload);
    expect(res.body).toHaveProperty('_id');
    createdId = res.body._id;
  });

  test('GET /api/users – after insert', async () => {
    const res = await request(httpServer).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]._id).toBe(createdId);
  });

  test('PUT /api/users/:id – update name', async () => {
    const res = await request(httpServer)
      .put(`/api/users/${createdId}`)
      .send({ name: 'Alice Updated', email: 'alice@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice Updated');
  });

  test('DELETE /api/users/:id – delete user', async () => {
    const res = await request(httpServer).delete(`/api/users/${createdId}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('User deleted successfully');
  });

  test('GET /api/users – empty again', async () => {
    const res = await request(httpServer).get('/api/users');
    expect(res.body).toEqual([]);
  });

  /* ---------- Error / edge‑case tests (7‑16) ---------- */
  test('POST /api/users – missing name', async () => {
    const payload = { email: 'no-name@example.com' };
    const res = await request(httpServer).post('/api/users').send(payload);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error creating user');
  });

  test('POST /api/users – missing email', async () => {
    const payload = { name: 'No Email' };
    const res = await request(httpServer).post('/api/users').send(payload);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error creating user');
  });

  test('POST /api/users – malformed JSON', async () => {
    const res = await request(httpServer)
      .post('/api/users')
      .set('Content-Type', 'application/json')
      .send('{"name":"Bad JSON", "email":"bad@example.com"'); // missing }
    expect(res.status).toBe(400);               // body‑parser rejects it
  });

  test('PUT /api/users/:id – non‑existent ID', async () => {
    const fakeId = '64b0c0c0c0c0c0c0c0c0c0c0'; // valid 24‑hex but not in DB
    const res = await request(httpServer)
      .put(`/api/users/${fakeId}`)
      .send({ name: 'Ghost', email: 'ghost@example.com' });
    expect(res.status).toBe(404);               // <-- updated to match new route
    expect(res.body.message).toBe('User not found');
  });

  test('PUT /api/users/:id – invalid ObjectId format', async () => {
    const res = await request(httpServer)
      .put('/api/users/invalid-id')
      .send({ name: 'Bad', email: 'bad@example.com' });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error updating user');
  });

  test('DELETE /api/users/:id – non‑existent ID', async () => {
    const fakeId = '64b0c0c0c0c0c0c0c0c0c0c0';
    const res = await request(httpServer).delete(`/api/users/${fakeId}`);
    expect(res.status).toBe(404);               // <-- updated
    expect(res.body.message).toBe('User not found');
  });

  test('DELETE /api/users/:id – invalid ObjectId format', async () => {
    const res = await request(httpServer).delete('/api/users/invalid-id');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error deleting user');
  });

  test('GET unknown route – 404 from static middleware', async () => {
    const res = await request(httpServer).get('/api/unknown');
    expect(res.status).toBe(404);
  });

  /* ---------- Additional happy‑path edge cases (17‑21) ---------- */
  test('POST /api/users – duplicate email (no unique index)', async () => {
    const payload = { name: 'Bob', email: 'bob@example.com' };
    const res1 = await request(httpServer).post('/api/users').send(payload);
    expect(res1.status).toBe(201);
    const res2 = await request(httpServer).post('/api/users').send(payload);
    expect(res2.status).toBe(201);
    secondUserId = res2.body._id;
  });

  test('GET /api/users – both users exist after duplicate test', async () => {
    const res = await request(httpServer).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);               // only the two Bobs
    const emails = res.body.map(u => u.email);
    // Both entries have the same email, so we just check that “bob@example.com” appears twice
    expect(emails.filter(e => e === 'bob@example.com')).toHaveLength(2);
  });

  test('PUT /api/users/:id – empty body (no fields to update)', async () => {
    const res = await request(httpServer)
      .put(`/api/users/${secondUserId}`)
      .send({});               // empty payload
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('bob@example.com');
    expect(res.body.name).toBe('Bob');
  });
});

/* -------------------------------------------------------------
   OAUTH REDIRECT ENDPOINTS
   ------------------------------------------------------------- */
describe('OAuth redirect endpoints', () => {
  test('GET /auth/linkedin – redirects with client_id', async () => {
    const res = await request(httpServer).get('/auth/linkedin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('client_id=');
  });

  test('GET /auth/google – redirects with client_id', async () => {
    const res = await request(httpServer).get('/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('client_id=');
  });
});

/* -------------------------------------------------------------
   OAUTH CALLBACKS – mocked external calls
   ------------------------------------------------------------- */
describe('OAuth callbacks (mocked)', () => {
  jest.mock('axios');
  const axios = require('axios');

  afterEach(() => jest.clearAllMocks());

  test('LinkedIn callback success redirects to /?code=linkedin', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'ln-token' } });
    axios.get.mockResolvedValue({
      data: {
        firstName: 'John',
        lastName: 'Doe',
        emailAddress: 'john.doe@linkedin.com',
        id: 'ln123',
      },
    });

    const res = await request(httpServer).get('/auth/linkedin/callback?code=abc');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?code=linkedin');

    const users = await request(httpServer).get('/api/users');
    const linkedInUser = users.body.find(u => u.linkedinId === 'ln123');
    expect(linkedInUser).toBeDefined();
    expect(linkedInUser.email).toBe('john.doe@linkedin.com');
  });

  test('Google callback success redirects to /?code=google', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'g-token' } });
    axios.get.mockResolvedValue({
      data: {
        name: 'Jane Smith',
        email: 'jane.smith@gmail.com',
        sub: 'g123',
      },
    });

    const res = await request(httpServer).get('/auth/google/callback?code=xyz');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?code=google');

    const users = await request(httpServer).get('/api/users');
    const googleUser = users.body.find(u => u.googleId === 'g123');
    expect(googleUser).toBeDefined();
    expect(googleUser.email).toBe('jane.smith@gmail.com');
  });
});

/* -------------------------------------------------------------
   WEBSOCKET BROADCASTING
   ------------------------------------------------------------- */
describe('WebSocket broadcasting', () => {
  let wsA, wsB;
  let wsPort;   // will be set after the server has started

  // -------------------------------------------------
  // Open two client connections before the test runs
  // -------------------------------------------------
  beforeAll((done) => {
    wsPort = wss.address().port;   // real server’s WS port (random in test mode)

    wsA = new WebSocket(`ws://localhost:${wsPort}`);
    wsB = new WebSocket(`ws://localhost:${wsPort}`);

    let opened = 0;
    const onOpen = () => {
      opened += 1;
      if (opened === 2) done();
    };
    wsA.on('open', onOpen);
    wsB.on('open', onOpen);
  });

  // -------------------------------------------------
  // Clean up the clients after the suite
  // -------------------------------------------------
  afterAll(() => {
    wsA.terminate();
    wsB.terminate();
  });

  // -------------------------------------------------
  // 1️⃣  Message broadcast test
  // -------------------------------------------------
  test('Message from A reaches B', (done) => {
    const testMsg = 'hello from A';

    wsB.once('message', (msg) => {
      const received = msg instanceof Buffer ? msg.toString() : msg;
      expect(received).toBe(testMsg);
      done();
    });

    wsA.send(testMsg);
  });

  // -------------------------------------------------
  // 2️⃣  Client disconnect is handled gracefully
  // -------------------------------------------------
  test('Client disconnect is handled gracefully', (done) => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    wsA.close();

    setTimeout(() => {
      expect(logSpy).toHaveBeenCalledWith('Client disconnected');
      logSpy.mockRestore();
      done();
    }, 100);
  });
});

describe('Mongoose connection fallback (devUri)', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    // Remove the variable so the code falls back to the dev URI
    delete process.env.MONGO_URI;
  });

  afterAll(() => {
    process.env = originalEnv; // restore
  });

  test('connects using the hard‑coded dev URI when MONGO_URI is missing', async () => {
    // Spy on mongoose.connect to capture the URI it receives
    const connectSpy = jest.spyOn(require('mongoose'), 'connect')
      .mockImplementation(() => Promise.resolve());

    // Re‑require the server module after the env change
    jest.resetModules();
    const { app } = require('../server');

    expect(connectSpy).toHaveBeenCalledWith('mongodb://localhost:27017/myDatabase');
    connectSpy.mockRestore();
  });
});


describe('Mongoose connection error handling', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    // Force the code to use the dev URI (or any bogus URI)
    delete process.env.MONGO_URI;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('logs an error when mongoose.connect rejects', async () => {
    const error = new Error('simulated connection failure');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Mock mongoose.connect to reject
    jest.spyOn(require('mongoose'), 'connect')
      .mockImplementation(() => Promise.reject(error));

    // Re‑require the server so the mocked connect runs
    jest.resetModules();
    require('../server'); // the module executes the connect line

    expect(consoleSpy).toHaveBeenCalledWith('Mongo connection error:', error);
    consoleSpy.mockRestore();
  });
});


describe('WebSocket server port selection (non‑test mode)', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    // Simulate a non‑test environment
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('listens on 8080 when NODE_ENV !== "test"', (done) => {
    // Re‑require the server after changing NODE_ENV
    jest.resetModules();
    const { wss } = require('../server');

    // The server should have bound to 8080
    expect(wss.address().port).toBe(8080);

    // Clean up
    wss.close(done);
  });
});

describe('GET /api/users – error handling', () => {
  let app, httpServer;

  beforeAll(async () => {
    // Mock the Mongoose model's `find` to reject
    jest.spyOn(require('mongoose').model('loginCredentials'), 'find')
      .mockImplementation(() => Promise.reject(new Error('find failed')));

    const serverModule = require('../server');
    app = serverModule.app;
    httpServer = require('http').createServer(app);
    await new Promise(res => httpServer.listen(0, res));
  });

  afterAll(async () => {
    await new Promise(res => httpServer.close(res));
    jest.restoreAllMocks();
  });

  test('returns 500 and proper JSON when find throws', async () => {
    const res = await request(httpServer).get('/api/users');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Error fetching users' });
  });
});

describe('LinkedIn callback – error handling', () => {
  const axios = require('axios');
  const { app } = require('../server');
  const httpServer = require('http').createServer(app);

  beforeAll(done => httpServer.listen(0, done));
  afterAll(done => httpServer.close(done));

  beforeEach(() => jest.clearAllMocks());

  test('returns 500 when token exchange fails', async () => {
    axios.post.mockRejectedValue(new Error('token error'));

    const res = await request(httpServer).get('/auth/linkedin/callback?code=bad');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Error logging in with LinkedIn' });
  });

  test('returns 500 when profile fetch fails', async () => {
    // token succeeds, profile request fails
    axios.post.mockResolvedValue({ data: { access_token: 'ln-token' } });
    axios.get.mockRejectedValue(new Error('profile error'));

    const res = await request(httpServer).get('/auth/linkedin/callback?code=bad');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Error logging in with LinkedIn' });
  });
});

describe('Google callback – error handling', () => {
  const axios = require('axios');
  const { app } = require('../server');
  const httpServer = require('http').createServer(app);

  beforeAll(done => httpServer.listen(0, done));
  afterAll(done => httpServer.close(done));

  beforeEach(() => jest.clearAllMocks());

  test('returns 500 when token exchange fails', async () => {
    axios.post.mockRejectedValue(new Error('token error'));

    const res = await request(httpServer).get('/auth/google/callback?code=bad');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Error logging in with Google' });
  });

  test('returns 500 when userinfo fetch fails', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'g-token' } });
    axios.get.mockRejectedValue(new Error('userinfo error'));

    const res = await request(httpServer).get('/auth/google/callback?code=bad');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Error logging in with Google' });
  });
});

describe('Standalone server start (require.main === module)', () => {
  const childProcess = require('child_process');
  const path = require('path');

  test('logs the start message and listens on 3000', (done) => {
    // Spawn a separate Node process that runs server.js directly
    const proc = childProcess.fork(path.resolve(__dirname, '../server.js'), {
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    let stdout = '';
    proc.stdout.on('data', data => (stdout += data.toString()));

    // Wait a short time for the log line to appear, then kill the process
    setTimeout(() => {
      expect(stdout).toMatch(/Server started on port 3000/);
      proc.kill();
      done();
    }, 500);
  });
});
