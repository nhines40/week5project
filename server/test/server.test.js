// ---------------------------------------------------------------
// server/test/server.test.js
// ---------------------------------------------------------------

const http = require('http');
const request = require('supertest');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');
const child_process = require('child_process');

// -------------------------------------------------------------
// In-memory MongoDB & Server setup
// -------------------------------------------------------------
let mongoServer;
let app;      // Express app exported from server.js
let wss;      // WebSocket server exported from server.js
let httpServer;

// -------------------------------------------------------------
// Start the in-memory MongoDB, set the env var, connect Mongoose,
// then require the server (which will use the same connection).
// -------------------------------------------------------------
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGO_URI = uri;

  await mongoose.connect(uri);

  const serverMod = require('../server');
  app = serverMod.app;
  wss = serverMod.wss;

  httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  await new Promise((resolve) => httpServer.close(resolve));
});

// -------------------------------------------------------------
// Helper to get the random port the Express server is listening on
// -------------------------------------------------------------
function getPort() {
  const address = httpServer.address();
  return typeof address === 'string' ? address : address.port;
}

// -------------------------------------------------------------
// User CRUD API tests
// -------------------------------------------------------------
describe('User CRUD API', () => {
  let createdId;

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
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Name and email are required');
  });

  test('POST /api/users – missing email', async () => {
    const payload = { name: 'No Email' };
    const res = await request(httpServer).post('/api/users').send(payload);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Name and email are required');
  });

  test('POST /api/users – malformed JSON', async () => {
    const res = await request(httpServer)
      .post('/api/users')
      .set('Content-Type', 'application/json')
      .send('{"name":"Bad JSON", "email":"bad@example.com"'); // missing }
    expect(res.status).toBe(400);               // body-parser rejects it
  });

  test('PUT /api/users/:id – non-existent ID', async () => {
    const fakeId = '64b0c0c0c0c0c0c0c0c0c0c0'; // valid 24-hex but not in DB
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

  test('DELETE /api/users/:id – non-existent ID', async () => {
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
  });

  test('GET /api/users – both users exist after duplicate test', async () => {
    const res = await request(httpServer).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const emails = res.body.map(u => u.email);
    expect(emails).toContain('bob@example.com');
    expect(emails).toContain('bob@example.com');
  });

  test('PUT /api/users/:id – empty body (no fields to update)', async () => {
    const res = await request(httpServer)
      .put(`/api/users/${createdId}`)
      .send({});               // empty payload
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('alice@example.com');
    expect(res.body.name).toBe('Alice');
  });
});

// -------------------------------------------------------------
// OAuth redirect endpoints
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// OAuth callbacks – mocked external calls (happy path)
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// WebSocket broadcasting
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// Mongoose connection error handling
// -------------------------------------------------------------
describe('Mongoose connection error handling', () => {
  const realConnect = mongoose.connect;

  afterAll(() => {
    mongoose.connect = realConnect;
  });

  test('connect rejection logs error', async () => {
    const mockConnect = jest.fn(() => Promise.reject(new Error('Simulated connection failure')));
    mongoose.connect = mockConnect;

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    jest.isolateModules(() => {
      require('../server');
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(mockConnect).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('Mongo connection error:', expect.any(Error));

    consoleSpy.mockRestore();
  });
});

// -------------------------------------------------------------
// GET /api/users error branch
// -------------------------------------------------------------
describe('GET /api/users error branch', () => {
  test('User.find rejection returns 500 and logs error', async () => {
    const modelName = mongoose.modelNames()[0];
    const User = mongoose.model(modelName);

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

// -------------------------------------------------------------
// LinkedIn callback error handling
// -------------------------------------------------------------
describe('LinkedIn callback error handling', () => {
  jest.mock('axios');
  const axios = require('axios');

  afterEach(() => jest.clearAllMocks());

  test('token exchange failure triggers catch', async () => {
    axios.post.mockRejectedValue(new Error('token request failed'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(httpServer).get('/auth/linkedin/callback?code=bad');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      message: 'Error logging in with LinkedIn',
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));

    consoleSpy.mockRestore();
  });
});

// -------------------------------------------------------------
// Google callback error handling
// -------------------------------------------------------------
describe('Google callback error handling', () => {
  jest.mock('axios');
  const axios = require('axios');

  afterEach(() => jest.clearAllMocks());

  test('token exchange failure triggers catch', async () => {
    axios.post.mockRejectedValue(new Error('google token error'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(httpServer).get('/auth/google/callback?code=bad');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      message: 'Error logging in with Google',
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));

    consoleSpy.mockRestore();
  });
});

// -------------------------------------------------------------
// Server start-up block
// -------------------------------------------------------------
describe('Server start-up block', () => {
  test('starts HTTP server on port 3000 and logs message', (done) => {
    const child = child_process.fork(path.resolve(__dirname, '../server.js'), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    setTimeout(() => {
      expect(stdout).toContain('Server started on port 3000');
      child.kill('SIGTERM');
      done();
    }, 1000);
  });
});

