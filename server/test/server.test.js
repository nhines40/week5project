// ---------------------------------------------------------------
// server/test/server.test.js
// ---------------------------------------------------------------

/* -------------- Imports -------------------------------------- */
const http = require('http');
const request = require('supertest');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');
const child_process = require('child_process');

/* -------------- In‑memory MongoDB & Server setup ------------ */
let mongoServer;
let app;      // Express app exported from server.js
let wss;      // WebSocket server exported from server.js
let httpServer;

/* --------------------------------------------------------------
   Start the in‑memory MongoDB, set the env var, connect Mongoose,
   then require the server (which will use the same connection).
   -------------------------------------------------------------- */
beforeAll(async () => {
  // 1️⃣  In‑memory DB
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGO_URI = uri;               // server.js reads this

  // 2️⃣  Connect Mongoose (used by the server)
  await mongoose.connect(uri);

  // 3️⃣  Require the server **after** the DB is ready
  const serverMod = require('../server');    // <-- relative to this file
  app = serverMod.app;
  wss = serverMod.wss;

  // 4️⃣  Start an HTTP server for SuperTest
  httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  await new Promise((resolve) => httpServer.close(resolve));
});

/* --------------------------------------------------------------
   Helper to get the random port the Express server is listening on
   -------------------------------------------------------------- */
function getPort() {
  const address = httpServer.address();
  return typeof address === 'string' ? address : address.port;
}

/* ==============================================================
   ====================== ORIGINAL TESTS =======================
   (unchanged – they already give you 23 passing tests)
   ============================================================== */
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
    expect(res.status).toBe(404);
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
    expect(res.status).toBe(404);
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
    expect(res.body).toHaveLength(2);
    const emails = res.body.map(u => u.email);
    expect(emails).toContain('alice@example.com');
    expect(emails).toContain('bob@example.com');
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
   OAuth redirect endpoints
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
   OAuth callbacks – mocked external calls (happy path)
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
   WebSocket broadcasting (original tests)
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

/* ==============================================================
   ====================== NEW TESTS ==============================
   (cover the lines that were previously uncovered)
   ============================================================== */

/* -------------------------------------------------------------
   1️⃣  Mongoose connection error handling
   ------------------------------------------------------------- */
describe('Mongoose connection error handling', () => {
  const realConnect = mongoose.connect; // keep a reference to restore later

  afterAll(() => {
    // Restore the original connect for any later tests (if any)
    mongoose.connect = realConnect;
  });

  test('connect rejection logs error', async () => {
    // Mock connect to reject
    const errMsg = 'Simulated connection failure';
    const mockConnect = jest.fn(() => Promise.reject(new Error(errMsg)));
    mongoose.connect = mockConnect;

    // Spy on console.error
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Re‑require the server inside an isolated module so the top‑level
    // `mongoose.connect(...).catch(...)` line runs again.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../server');
    });

    // Give the rejected promise a tick to be handled
    await new Promise((r) => setTimeout(r, 0));

    expect(mockConnect).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Mongo connection error:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});

/* -------------------------------------------------------------
   2️⃣  GET /api/users error branch (User.find rejection)
   ------------------------------------------------------------- */
describe('GET /api/users error branch', () => {
  test('User.find rejection returns 500 and logs error', async () => {
    // Retrieve the model **after** it has been defined by server.js
    const modelName = mongoose.modelNames()[0]; // generic – works even if renamed
    const User = mongoose.model(modelName);

    // Mock User.find to reject
    const findMock = jest
      .spyOn(User, 'find')
      .mockImplementation(() => Promise.reject(new Error('forced find error')));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(httpServer).get('/api/users');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Error fetching users' });
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));

    findMock.mockRestore();
    consoleSpy.mockRestore();
  });
});

/* -------------------------------------------------------------
   3️⃣  LinkedIn callback – force final catch
   ------------------------------------------------------------- */
describe('LinkedIn callback error handling', () => {
  jest.mock('axios');
  const axios = require('axios');

  afterEach(() => jest.clearAllMocks());

  test('token exchange failure triggers catch', async () => {
    // Force the token request to reject
    axios.post.mockRejectedValue(new Error('token request failed'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(httpServer).get(
      '/auth/linkedin/callback?code=bad'
    );
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      message: 'Error logging in with LinkedIn',
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));

    consoleSpy.mockRestore();
  });
});

/* -------------------------------------------------------------
   4️⃣  Google callback – force final catch
   ------------------------------------------------------------- */
describe('Google callback error handling', () => {
  jest.mock('axios');
  const axios = require('axios');

  afterEach(() => jest.clearAllMocks());

  test('token exchange failure triggers catch', async () => {
    // Force the token request to reject
    axios.post.mockRejectedValue(new Error('google token error'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(httpServer).get(
      '/auth/google/callback?code=bad'
    );
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      message: 'Error logging in with Google',
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));

    consoleSpy.mockRestore();
  });
});

/* -------------------------------------------------------------
   5️⃣  Server start‑up block (require.main === module)
   ------------------------------------------------------------- */
describe('Server start‑up block (require.main === module)', () => {
  test('starts HTTP server on port 3000 and logs message', (done) => {
    // Spawn a child process that runs server.js directly.
    const child = child_process.fork(
      path.resolve(__dirname, '../server.js'), // absolute path to server.js
      [], // no extra args
      {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], // capture stdout/stderr
      }
    );

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // Give the child a short moment to start and log.
    setTimeout(() => {
      expect(stdout).toContain('Server started on port 3000');
      // Cleanly shut the child down.
      child.kill('SIGTERM');
      done();
    }, 500); // 0.5 s is enough for the server to start
  });
});
