function get_username() {
  const username = document.getElementById("username").value;
  if (username === "") {
    showPageMessage("Error: Please enter your username.", "error");
    return null;
  }
  return username;
}