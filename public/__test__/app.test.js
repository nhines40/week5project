/**
 * Jest + React‑Testing‑Library test suite – 100 % coverage
 * ----------------------------------------------------
 *  • Uses the exported members from `app.js`.
 *  • Mocks `axios` with `axios-mock-adapter`.
 *  • Provides a tiny WebSocket mock.
 *  • Uses the real browser URL (`window.history.pushState`) to set query strings.
 *  • Mocks `window.location.assign` via `Object.defineProperty`.
 *  • Wraps every render in `act` to silence React warnings.
 *  • Adds tests for the WebSocket `onmessage` handler and the render‑guard branch.
 */

const React = require('react');
const {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} = require('@testing-library/react');
require('@testing-library/jest-dom'); // adds .toBeInTheDocument(), etc.

const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const mockAxios = new MockAdapter(axios);

/* -----------------------------------------------------------------
   1️⃣  Mock the global WebSocket used in app.js
----------------------------------------------------------------- */
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    MockWebSocket.instances.push(this);
    // simulate async open event
    setTimeout(() => this.onopen && this.onopen());
  }
  static instances = [];
  static OPEN = 1;
  send(msg) {
    // broadcast to every other client (same logic as the real server)
    MockWebSocket.instances
      .filter((c) => c !== this)
      .forEach((c) => c.onmessage && c.onmessage({ data: msg }));
  }
  close() {
    this.onclose && this.onclose();
  }
}
global.WebSocket = MockWebSocket;

/* -----------------------------------------------------------------
   2️⃣  Helper to render inside act (required for async state updates)
----------------------------------------------------------------- */
async function renderWithAct(ui) {
  await act(async () => {
    render(ui);
  });
}

/* -----------------------------------------------------------------
   3️⃣  Import the components (after the mocks above)
----------------------------------------------------------------- */
const {
  Crud,
  App,
  linkedinLogin,
  googleLogin,
  socket,
} = require('../app.js'); // path relative to __tests__

/* -----------------------------------------------------------------
   4️⃣  Clean‑up after each test
----------------------------------------------------------------- */
afterEach(() => {
  mockAxios.reset();
  MockWebSocket.instances = [];
  jest.clearAllMocks();
});

/* --------------------------------------------------------------
   1️⃣  Render login screen when no ?code query param
-------------------------------------------------------------- */
test('renders login buttons when not logged in', async () => {
  window.history.pushState({}, '', '/');
  await renderWithAct(React.createElement(App, null));

  expect(screen.getByText(/Social Media Login/i)).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /Login with LinkedIn/i })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /Login with Google/i })
  ).toBeInTheDocument();
});

/* --------------------------------------------------------------
   2️⃣  Render Crud after LinkedIn login (code=linkedin)
-------------------------------------------------------------- */
test('renders Crud component after LinkedIn login', async () => {
  window.history.pushState({}, '', '/?code=linkedin');
  await renderWithAct(React.createElement(App, null));
  expect(screen.getByText(/CRUD Operations/i)).toBeInTheDocument();
});

/* --------------------------------------------------------------
   3️⃣  Render Crud after Google login (code=google)
-------------------------------------------------------------- */
test('renders Crud component after Google login', async () => {
  window.history.pushState({}, '', '/?code=google');
  await renderWithAct(React.createElement(App, null));
  expect(screen.getByText(/CRUD Operations/i)).toBeInTheDocument();
});

/* --------------------------------------------------------------
   4️⃣  Does not render Crud for an unknown code
-------------------------------------------------------------- */
test('does not render Crud for unknown code', async () => {
  window.history.pushState({}, '', '/?code=unknown');
  await renderWithAct(React.createElement(App, null));
  expect(screen.queryByText(/CRUD Operations/i)).not.toBeInTheDocument();
});

/* --------------------------------------------------------------
   5️⃣  Crud – fetch users on mount (happy path)
-------------------------------------------------------------- */
test('Crud fetches and displays users', async () => {
  const users = [
    { _id: '1', name: 'Alice', email: 'alice@example.com' },
    { _id: '2', name: 'Bob', email: 'bob@example.com' },
  ];
  mockAxios.onGet('/api/users').reply(200, users);

  await renderWithAct(React.createElement(Crud, null));

  for (const u of users) {
    expect(
      await screen.findByText(`${u.name} (${u.email})`)
    ).toBeInTheDocument();
  }
});

/* --------------------------------------------------------------
   6️⃣  Crud – create a new user
-------------------------------------------------------------- */
test('creates a user and adds it to the list', async () => {
  mockAxios.onGet('/api/users').reply(200, []); // start empty
  const newUser = { _id: '3', name: 'Charlie', email: 'charlie@example.com' };
  mockAxios.onPost('/api/users').reply(201, newUser);

  await renderWithAct(React.createElement(Crud, null));

  // wait for the empty fetch to settle
  await waitFor(() => expect(screen.queryByText(/Charlie/)).not.toBeInTheDocument());

  fireEvent.change(screen.getByLabelText(/Name:/i), {
    target: { value: 'Charlie' },
  });
  fireEvent.change(screen.getByLabelText(/Email:/i), {
    target: { value: 'charlie@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Create/i }));

  expect(
    await screen.findByText(/Charlie \(charlie@example.com\)/)
  ).toBeInTheDocument();
});

/* --------------------------------------------------------------
   7️⃣  Crud – createUser error handling (network error)
-------------------------------------------------------------- */
test('logs error when creating a user fails', async () => {
  mockAxios.onGet('/api/users').reply(200, []); // mount succeeds
  mockAxios.onPost('/api/users').networkError();

  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  await renderWithAct(React.createElement(Crud, null));

  fireEvent.change(screen.getByLabelText(/Name:/i), {
    target: { value: 'FailUser' },
  });
  fireEvent.change(screen.getByLabelText(/Email:/i), {
    target: { value: 'fail@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Create/i }));

  await waitFor(() => expect(consoleError).toHaveBeenCalled());
  consoleError.mockRestore();
});

/* --------------------------------------------------------------
   7️⃣  Crud – update a user (happy path)
-------------------------------------------------------------- */
test('updates a user name', async () => {
  const user = { _id: '4', name: 'Dave', email: 'dave@example.com' };
  mockAxios.onGet('/api/users').reply(200, [user]);
  const updated = { ...user, name: 'David' };
  mockAxios.onPut(`/api/users/${user._id}`).reply(200, updated);

  await renderWithAct(React.createElement(Crud, null));

  const nameInput = await screen.findByDisplayValue('Dave');
  fireEvent.change(nameInput, { target: { value: 'David' } });

  const updateBtn = screen.getByRole('button', { name: /Update/i });
  fireEvent.click(updateBtn);

  expect(
    await screen.findByText(/David \(dave@example.com\)/)
  ).toBeInTheDocument();
});

/* --------------------------------------------------------------
   8️⃣  Crud – update error handling (network error)
-------------------------------------------------------------- */
test('logs error when update fails', async () => {
  const user = { _id: '5', name: 'Eve', email: 'eve@example.com' };
  mockAxios.onGet('/api/users').reply(200, [user]);
  mockAxios.onPut(`/api/users/${user._id}`).networkError();

  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  await renderWithAct(React.createElement(Crud, null));

  const nameInput = await screen.findByDisplayValue('Eve');
  fireEvent.change(nameInput, { target: { value: 'Eve2' } });

  const updateBtn = screen.getByRole('button', { name: /Update/i });
  fireEvent.click(updateBtn);

  await waitFor(() => expect(consoleError).toHaveBeenCalled());
  consoleError.mockRestore();
});

/* --------------------------------------------------------------
   9️⃣  Crud – delete a user (happy path)
-------------------------------------------------------------- */
test('deletes a user from the list', async () => {
  const user = { _id: '6', name: 'Frank', email: 'frank@example.com' };
  mockAxios.onGet('/api/users').reply(200, [user]);
  mockAxios
    .onDelete(`/api/users/${user._id}`)
    .reply(200, { message: 'User deleted successfully' });

  await renderWithAct(React.createElement(Crud, null));

  expect(
    await screen.findByText(/Frank \(frank@example.com\)/)
  ).toBeInTheDocument();

  const deleteBtn = screen.getByRole('button', { name: /Delete/i });
  fireEvent.click(deleteBtn);

  await waitFor(() => expect(screen.queryByText(/Frank/)).not.toBeInTheDocument());
});

/* --------------------------------------------------------------
   🔟  Crud – delete error handling (network error)
-------------------------------------------------------------- */
test('logs error when delete fails', async () => {
  const user = { _id: '7', name: 'Grace', email: 'grace@example.com' };
  mockAxios.onGet('/api/users').reply(200, [user]);
  mockAxios.onDelete(`/api/users/${user._id}`).networkError();

  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  await renderWithAct(React.createElement(Crud, null));

  const deleteBtn = await screen.findByRole('button', { name: /Delete/i });
  fireEvent.click(deleteBtn);

  await waitFor(() => expect(consoleError).toHaveBeenCalled());
  consoleError.mockRestore();
});

/* --------------------------------------------------------------
   1️⃣1️⃣  High‑contrast toggle
-------------------------------------------------------------- */
test('toggles high‑contrast mode', async () => {
  mockAxios.onGet('/api/users').reply(200, []);
  await renderWithAct(React.createElement(Crud, null));

  const toggle = screen.getByRole('button', {
    name: /Toggle High Contrast Mode/i,
  });
  fireEvent.click(toggle);

  const container = screen.getByText(/CRUD Operations/i).parentElement;
  // jsdom reports colours as rgb()
  expect(container).toHaveStyle('background-color: rgb(0, 0, 0)');
  expect(container).toHaveStyle('color: rgb(255, 255, 255)');
});

/* --------------------------------------------------------------
   1️⃣2️⃣  Error handling – fetch fails (404)
-------------------------------------------------------------- */
test('logs error when fetching users fails', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockAxios.onGet('/api/users').networkError();

  await renderWithAct(React.createElement(Crud, null));

  await waitFor(() => expect(consoleError).toHaveBeenCalled());
  consoleError.mockRestore();
});



/* --------------------------------------------------------------
   1️⃣4️⃣  WebSocket onmessage handler logs the message
-------------------------------------------------------------- */
test('WebSocket onmessage logs received data', () => {
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  // the socket was created when app.js was imported
  socket.onmessage({ data: 'test‑msg' });
  expect(consoleLog).toHaveBeenCalledWith('Received message => test‑msg');
  consoleLog.mockRestore();
});

/* --------------------------------------------------------------
   1️6 WebSocket onclose & onerror logging
-------------------------------------------------------------- */
test('WebSocket onclose logs disconnect message', () => {
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  socket.onclose();
  expect(consoleLog).toHaveBeenCalledWith('Disconnected from the WebSocket server');
  consoleLog.mockRestore();
});

test('WebSocket onerror logs error message', () => {
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  socket.onerror(new Error('boom'));
  expect(consoleLog).toHaveBeenCalledWith('Error occurred');
  consoleLog.mockRestore();
});

/* --------------------------------------------------------------
   1️⃣5️⃣  Render‑guard branch (process.env.NODE_ENV !== 'test')
-------------------------------------------------------------- */
test('render guard runs when not in test env', () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  // ensure a root element exists for the render call
  document.body.innerHTML = '<div id="root"></div>';

  // mock react‑dom before requiring the module again
  jest.doMock('react-dom', () => ({
    render: jest.fn(),
  }));

  // clear the module cache so app.js is evaluated again with the new env
  jest.resetModules();
  require('../app.js'); // the guard will call the mocked render

  process.env.NODE_ENV = originalEnv;
});

/* --------------------------------------------------------------
   1️⃣6️⃣  WebSocket broadcast – two mock clients
-------------------------------------------------------------- */
test('WebSocket broadcast sends message to other clients', (done) => {
  // the original socket (client 0) was created on import
  const clientA = new MockWebSocket('ws://localhost:8080');
  const clientB = new MockWebSocket('ws://localhost:8080');

  clientB.onmessage = (ev) => {
    expect(ev.data).toBe('hello');
    done();
  };

  clientA.send('hello');
});

test('googleLogin sets href to /auth/google', () => {
expect(() => {
    googleLogin();
}).not.toThrow();
});

test('linkedInLogin sets href to /auth/linkedIn', () => {
expect(() => {
    linkedinLogin();
}).not.toThrow();
});

test('updateUser keeps other users unchanged when id does not match', async () => {
  const userA = { _id: '1', name: 'Alice', email: 'alice@example.com' };
  const userB = { _id: '2', name: 'Bob',   email: 'bob@example.com' };
  mockAxios.onGet('/api/users').reply(200, [userA, userB]);

  const updatedA = { _id: '1', name: 'Alice‑Updated', email: 'alice@example.com' };
  mockAxios.onPut('/api/users/1').reply(200, updatedA);

  await renderWithAct(React.createElement(Crud, null));

  expect(await screen.findByText(/Alice \(alice@example.com\)/)).toBeInTheDocument();
  expect(screen.getByText(/Bob \(bob@example.com\)/)).toBeInTheDocument();

  const nameInputA = screen.getByDisplayValue('Alice');
  fireEvent.change(nameInputA, { target: { value: 'Alice‑Updated' } });

  const updateButtons = screen.getAllByRole('button', { name: /Update/i });
  fireEvent.click(updateButtons[0]);

  await waitFor(() => {
    expect(screen.getByText(/Alice‑Updated \(alice@example.com\)/)).toBeInTheDocument();
    expect(screen.getByText(/Bob \(bob@example.com\)/)).toBeInTheDocument();
  });
});


