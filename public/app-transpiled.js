(() => {
  // public/app.js
  var React = window.React;
  var ReactDOM = window.ReactDOM;
  var axios = window.axios;
  var socket = new WebSocket("ws://localhost:8080");
  socket.onmessage = (event) => {
    console.log(`Received message => ${event.data}`);
  };
  socket.onopen = () => {
    console.log("Connected to the WebSocket server");
  };
  socket.onclose = () => {
    console.log("Disconnected from the WebSocket server");
  };
  socket.onerror = (error) => {
    console.log("Error occurred");
  };
  var linkedinLogin = () => {
    window.location.href = "/auth/linkedin";
  };
  var googleLogin = () => {
    window.location.href = "/auth/google";
  };
  var Crud = () => {
    const [users, setUsers] = React.useState([]);
    const [name, setName] = React.useState("");
    const [email, setEmail] = React.useState("");
    const [highContrastMode, setHighContrastMode] = React.useState(false);
    React.useEffect(() => {
      axios.get("/api/users").then((response) => {
        setUsers(response.data);
      }).catch((error) => {
        console.error(error);
      });
    }, []);
    const createUser = (e) => {
      e.preventDefault();
      const nameValue = document.getElementById("name").value;
      const emailValue = document.getElementById("email").value;
      axios.post("/api/users", { name: nameValue, email: emailValue }).then((response) => {
        setUsers([...users, response.data]);
        document.getElementById("name").value = "";
        document.getElementById("email").value = "";
      }).catch((error) => {
        console.error(error);
      });
    };
    const updateUser = (id) => {
      const nameValue = document.getElementById(`name-${id}`).value;
      const emailValue = document.getElementById(`email-${id}`).value;
      console.log("Updating user with ID:", id);
      console.log("Name:", nameValue);
      console.log("Email:", emailValue);
      axios.put(`/api/users/${id}`, { name: nameValue, email: emailValue }).then((response) => {
        console.log("Update response:", response);
        setUsers(users.map((user) => user._id === id ? response.data : user));
      }).catch((error) => {
        console.error("Update error:", error);
      });
    };
    const deleteUser = (id) => {
      console.log("Deleting user with ID:", id);
      axios.delete(`/api/users/${id}`).then((response) => {
        console.log("Delete response:", response);
        setUsers(users.filter((user) => user._id !== id));
      }).catch((error) => {
        console.error("Delete error:", error);
      });
    };
    const toggleHighContrastModeHandler = () => {
      setHighContrastMode(!highContrastMode);
    };
    return React.createElement(
      "div",
      { style: { textAlign: "center", width: "100%", backgroundColor: highContrastMode ? "black" : "", color: highContrastMode ? "white" : "" } },
      React.createElement(
        "button",
        { onClick: toggleHighContrastModeHandler, style: { margin: "10px" } },
        "Toggle High Contrast Mode"
      ),
      React.createElement("h1", { style: { margin: "10px" } }, "CRUD Operations"),
      React.createElement(
        "form",
        { onSubmit: createUser, style: { margin: "10px" } },
        React.createElement("label", { style: { display: "block", margin: "10px" } }, "Name:"),
        React.createElement("input", { type: "text", id: "name", style: { width: "50%", margin: "10px" } }),
        React.createElement("br", null),
        React.createElement("label", { style: { display: "block", margin: "10px" } }, "Email:"),
        React.createElement("input", { type: "email", id: "email", style: { width: "50%", margin: "10px" } }),
        React.createElement("br", null),
        React.createElement("button", { type: "submit", style: { margin: "10px" } }, "Create")
      ),
      React.createElement(
        "ul",
        { style: { listStyle: "none", padding: "0", margin: "0" } },
        users.map((user) => React.createElement(
          "li",
          { key: user._id, style: { margin: "10px" } },
          React.createElement("span", { style: { display: "block", margin: "10px" } }, `${user.name} (${user.email})`),
          React.createElement(
            "form",
            { onSubmit: (e) => {
              e.preventDefault();
              updateUser(user._id);
            }, style: { margin: "10px" } },
            React.createElement("input", { type: "text", id: `name-${user._id}`, defaultValue: user.name, style: { width: "50%", margin: "10px" } }),
            React.createElement("input", { type: "email", id: `email-${user._id}`, defaultValue: user.email, style: { width: "50%", margin: "10px" } }),
            React.createElement("button", { type: "submit", style: { margin: "10px" } }, "Update")
          ),
          React.createElement("button", { onClick: () => deleteUser(user._id), style: { margin: "10px" } }, "Delete")
        ))
      )
    );
  };
  var App = () => {
    const [isLoggedIn, setIsLoggedIn] = React.useState(false);
    const [loginCode, setLoginCode] = React.useState(null);
    React.useEffect(() => {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("code")) {
        setLoginCode(urlParams.get("code"));
        setIsLoggedIn(true);
      }
    }, []);
    return React.createElement(
      "div",
      null,
      !isLoggedIn && React.createElement(
        "div",
        { className: "container" },
        React.createElement("h1", null, "Social Media Login"),
        React.createElement("button", { id: "linkedin-login", onClick: linkedinLogin }, "Login with LinkedIn"),
        React.createElement("button", { id: "google-login", onClick: googleLogin }, "Login with Google")
      ),
      isLoggedIn && loginCode === "linkedin" && React.createElement(Crud, null),
      isLoggedIn && loginCode === "google" && React.createElement(Crud, null)
    );
  };
  ReactDOM.render(React.createElement(
    App,
    null
  ), document.getElementById("root"));
})();
