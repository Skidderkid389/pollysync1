// PollySync client results module
// This file will load campaign results separately from the login code.

window.loadPollySyncClientResults = async function () {
  const message = document.getElementById("clientLiveResultsMessage");

  if (!message) {
    console.log("PollySync results area is not open yet.");
    return;
  }

  message.textContent = "Preparing to load campaign results...";
};