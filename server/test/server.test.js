/**
 * server/test/server.test.js
 * -------------------------------------------------
 * 1️⃣  Original test suite (unchanged)
 * 2️⃣  Extra tests that cover the previously uncovered branches
 * -------------------------------------------------
 */

const http = require('http');
const request = require('supertest');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const childProcess = require('child_process');
const path = require('path');

/* -------------------------------------------------
   GLOBAL MOCKS
   ------------------------------------------------- */
// `axios` is used in the OAuth callbacks – we mock it once for the whole file.
// Individual tests set the concrete implementation they need.
jest.mock('axios');
const axios = require('axios');

/* ==============================================================
   0️⃣  GLOBAL SET‑UP – in‑memory MongoDB for the original suite
   ============================================================== */
let mongoServer;
let app;      // Express app exported from server.js
let wss;      // WebSocket server exported from server.js
let httpServer; // HTTP server that wraps `app`

beforeAll(async () => {
  // ---------- 1️⃣ spin up in‑memory MongoDB ----------
  mongoServer = await MongoMemoryServer.create();
 const uri = mongoServer.getUri();

  // Make the URI visible to server.js (it reads process.env.MONGO_URI)
  process.env.MONGO_URI = uri;

  // Connect Mongoose once – server.js will reuse this connection
  await mongoose.connect(uri);

  // ---------- 2️⃣ clear the collection ----------
  await mongoose.connection.collection('logincredentials').deleteMany({});

  // ---------- 3️⃣ require the server (app + wss) ----------
  const serverModule = require('../server'); // relative to this file
  app = serverModule.app;
  wss = serverModule.wss;

  // ---------- 4️⃣ start an HTTP server for the original tests ----------
  httpServer = http.createServer(app);
  await new Promise((res) => httpServer.listen(0, res)); // random free port
});

afterAll(async () => {
  // Close everything that the original suite created
  await new Promise((res) => httpServer.close(res));
  wss.close();
  await mongoose.disconnect();
  await mongoServer.stop();
});

/* ==============================================================
   1️⃣  ORIGINAL USER CRUD / OAUTH / WEBSOCKET TESTS
   ============================================================== */
describe('User CRUD API', () => {
  let createdId;          // id of the first user we create
  let secondUserId;       // id of the duplicate‑email user (used later)

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
    expect(res.status).toBe(400);
  });

  test('PUT /api/users/:id – non existent ID', async () => {
    const fakeId = '64b0c0c0c0c0c0c0c0c0c0c0';
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

  test('DELETE /api/users/:id – non existent ID', async () => {
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
    const emails = res.body.map((u) => u.email);
    expect(emails.filter((e) => e === 'bob@example.com')).toHaveLength(2);
  });

  test('PUT /api/users/:id – empty body (no fields to update)', async () => {
    const res = await request(httpServer)
      .put(`/api/users/${secondUserId}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('bob@example.com');
    expect(res.body.name).toBe('Bob');
  });
});

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

describe('OAuth callbacks (mocked)', () => {
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

    const res = await request(httpServer).get(
      '/auth/linkedin/callback?code=abc'
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?code=linkedin');

    const users = await request(httpServer).get('/api/users');
    const linkedInUser = users.body.find((u) => u.linkedinId === 'ln123');
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

    const res = await request(httpServer).get(
      '/auth/google/callback?code=xyz'
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?code=google');

    const users = await request(httpServer).get('/api/users');
    const googleUser = users.body.find((u) => u.googleId === 'g123');
    expect(googleUser).toBeDefined();
    expect(googleUser.email).toBe('jane.smith@gmail.com');
  });
});

describe('WebSocket broadcasting', () => {
  let wsA, wsB;
  let wsPort;

  beforeAll((done) => {
    wsPort = wss.address().port;
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

  afterAll(() => {
    wsA.terminate();
    wsB.terminate();
  });

  test('Message from A reaches B', (done) => {
    const testMsg = 'hello from A';
    wsB.once('message', (msg) => {
      const received = msg instanceof Buffer ? msg.toString() : msg;
      expect(received).toBe(testMsg);
      done();
    });
    wsA.send(testMsg);
  });

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
   2️⃣  EXTRA TESTS – previously uncovered branches
   ============================================================== */

/* -------------------------------------------------
   2.1  Mongoose connection fallback (devUri)
   ------------------------------------------------- */
describe('Mongoose connection fallback (devUri)', () => {
  const originalEnv = { ...process.env };
  let connectSpy;

  beforeAll(() => {
    delete process.env.MONGO_URI; // force fallback
    // Load the module in isolation so it reads the new env
    jest.isolateModules(() => {
      const mongoose = require('mongoose');
      connectSpy = jest
        .spyOn(mongoose, 'connect')
        .mockImplementation(() => Promise.resolve());
      // eslint-disable-next-line global-require
      require('../server');
    });
  });

  afterAll(() => {
    connectSpy.mockRestore();
    process.env = originalEnv;
  });

  test('uses the hard‑coded dev URI when MONGO_URI is missing', () => {
    expect(connectSpy).toHaveBeenCalledWith(
      'mongodb://localhost:27017/myDatabase'
    );
  });
});

/* -------------------------------------------------
   2.2  Mongoose connection error handling
   ------------------------------------------------- */
describe('Mongoose connection error handling', () => {
  const originalEnv = { ...process.env };
  const fakeError = new Error('simulated connection failure');

  beforeAll(() => {
    delete process.env.MONGO_URI;
    jest.isolateModules(() => {
      const mongoose = require('mongoose');
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest
        .spyOn(mongoose, 'connect')
        .mockImplementation(() => Promise.reject(fakeError));

      // eslint-disable-next-line global-require
      require('../server');
    });
  });

  afterAll(() => {
    console.error.mockRestore();
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  test('logs the connection error', () => {
    expect(console.error).toHaveBeenCalledWith(
      'Mongo connection error:',
      fakeError
    );
  });
});

/* -------------------------------------------------
   2.3  WebSocket server on port 8080 (non‑test mode)
   ------------------------------------------------- */
describe('WebSocket server port selection (non‑test mode)', () => {
  const originalEnv = { ...process.env };
  let wssLocal;

  beforeAll(() => {
    process.env.NODE_ENV = 'development'; // not "test"
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const server = require('../server');
      wssLocal = server.wss;
    });
  });

  afterAll((done) => {
    wssLocal.close(() => {
      process.env = originalEnv;
      done();
    });
  });

  test('binds to 8080 when NODE_ENV !== "test"', () => {
    expect(wssLocal.address().port).toBe(8080);
  });
});

/* -------------------------------------------------
   2.4  GET /api/users error handling
   ------------------------------------------------- */
describe('GET /api/users – error handling', () => {
  let httpSrv;
  let serverMod;

  beforeAll(async () => {
    // Mock the model's find() to reject **before** the server is required
    const User = mongoose.model('loginCredentials');
    jest
      .spyOn(User, 'find')
      .mockImplementation(() => Promise.reject(new Error('find failed')));

    // Load a fresh server instance that will use the mocked model
    jest.resetModules();
    // eslint-disable-next-line global-require
    serverMod = require('../server');

    httpSrv = http.createServer(serverMod.app);
    await new Promise((r) => httpSrv.listen(0, r));
  });

  afterAll(async () => {
    await new Promise((r) => httpSrv.close(r));
    // Close the WS server that was created with this fresh instance
    serverMod.wss.close();
    jest.restoreAllMocks();
  });

  test('returns 500 with proper JSON', async () => {
    const res = await request(httpSrv).get('/api/users');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Error fetching users' });
  });
});

/* -------------------------------------------------
   2.5  LinkedIn callback – error handling
   ------------------------------------------------- */
describe('LinkedIn callback – error handling', () => {
  let httpSrv;
  let serverMod;

  beforeAll((done) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      serverMod = require('../server');
    });
    httpSrv = http.createServer(serverMod.app);
    httpSrv.listen(0, done);
  });

  afterAll((done) => {
    httpSrv.close(() => {
      serverMod.wss.close();
      jest.clearAllMocks();
      done();
    });
  });

  test('token exchange failure → 500', async () => {
    axios.post.mockRejectedValue(new Error('token error'));

    const res = await request(httpSrv).get(
      '/auth/linkedin/callback?code=bad'
    );
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      message: 'Error logging in with LinkedIn',
    });
  });

  test('profile fetch failure → 500', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'ln-token' } });
    axios.get.mockRejectedValue(new Error('profile error'));

    const res = await request(httpSrv).get(
      '/auth/linkedin/callback?code=bad'
    );
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      message: 'Error logging in with LinkedIn',
    });
  });
});

/* -------------------------------------------------
   2.6  Google callback – error handling
   ------------------------------------------------- */
describe('Google callback – error handling', () => {
  let httpSrv;
  let serverMod;

  beforeAll((done) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      serverMod = require('../server');
    });
    httpSrv = http.createServer(serverMod.app);
    httpSrv.listen(0, done);
  });

  afterAll((done) => {
    httpSrv.close(() => {
      serverMod.wss.close();
      jest.clearAllMocks();
      done();
    });
  });

  test('token exchange failure → 500', async () => {
    axios.post.mockRejectedValue(new Error('token error'));

    const res = await request(httpSrv).get(
      '/auth/google/callback?code=bad'
    );
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      message: 'Error logging in with Google',
    });
  });

  test('userinfo fetch failure → 500', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'g-token' } });
    axios.get.mockRejectedValue(new Error('userinfo error'));

    const res = await request(httpSrv).get(
      '/auth/google/callback?code=bad'
    );
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      message: 'Error logging in with Google',
    });
  });
});

/* -------------------------------------------------
   2.7  Stand‑alone server start (require.main === module)
   ------------------------------------------------- */
describe('Standalone server start (require.main === module)', () => {
  test('logs "Server started on port 3000"', (done) => {
    // Spawn a separate node process; we only need the stdout line.
    const child = childProcess.spawn('node', [path.resolve(__dirname, '../server.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        // Ensure the child does NOT try to use the in‑memory URI
        MONGO_URI: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      done(new Error('Did not see the start‑up log within 5 s'));
    }, 5000);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (/Server started on port 3000/.test(stdout)) {
        clearTimeout(timeout);
        child.kill('SIGTERM');
        try {
          expect(stdout).toMatch(/Server started on port 3000/);
          done();
        } catch (e) {
          done(e);
        }
      }
    });

    child.stderr.on('data', (data) => {
      // If the child crashes, forward the error
      clearTimeout(timeout);
      child.kill('SIGTERM');
      done(new Error(`Child process error: ${data.toString()}`));
    });
  });
});
