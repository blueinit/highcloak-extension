"use strict";

(function () {
  var SERVER_URL = "http://localhost:8000";

  function checkStatus() {
    var dot = document.getElementById("dot");
    var text = document.getElementById("status-text");

    fetch(SERVER_URL + "/health", { method: "GET" })
      .then(function (res) {
        if (res.ok) {
          dot.classList.remove("offline");
          text.textContent = "Server running \u2014 enhanced detection active";
        } else {
          throw new Error("not ok");
        }
      })
      .catch(function () {
        dot.classList.add("offline");
        text.textContent = "Local detection active \u2014 server optional";
      });
  }

  checkStatus();
})();
