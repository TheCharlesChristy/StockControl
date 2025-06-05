
function get_password() {
  const password = document.getElementById("password").value;
  if (password === "") {
    showPageMessage("Error: Please enter your password.", "error");
    return null;
  }
  return password;
}

function checkPasswordStrength(password) {
  let strength = 0;
  let feedback = [];

  // Length check
  if (password.length >= 8) {
    strength += 1;
  } else {
    feedback.push("At least 8 characters");
  }

  // Lowercase check
  if (/[a-z]/.test(password)) {
    strength += 1;
  } else {
    feedback.push("One lowercase letter");
  }

  // Uppercase check
  if (/[A-Z]/.test(password)) {
    strength += 1;
  } else {
    feedback.push("One uppercase letter");
  }

  // Number check
  if (/\d/.test(password)) {
    strength += 1;
  } else {
    feedback.push("One number");
  }

  // Special character check
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    strength += 1;
  } else {
    feedback.push("One special character");
  }

  return { strength, feedback };
}

function updatePasswordStrength() {
  const passwordInput = document.getElementById("password");
  const strengthFill = document.getElementById("password-strength-fill");
  const strengthText = document.getElementById("password-strength-text");
  
  const password = passwordInput.value;
  const { strength, feedback } = checkPasswordStrength(password);
  
  // Remove existing strength classes
  strengthFill.classList.remove("strength-weak", "strength-fair", "strength-good", "strength-strong");
  
  if (password.length === 0) {
    strengthFill.style.width = "0%";
    strengthText.textContent = "Password strength";
    strengthText.style.color = "#666";
    return;
  }
  
  // Update progress bar
  const percentage = (strength / 5) * 100;
  strengthFill.style.width = percentage + "%";
  
  // Update color and text based on strength
  let strengthLevel = "";
  let strengthColor = "#666";
  
  if (strength <= 1) {
    strengthLevel = "Very Weak";
    strengthFill.classList.add("strength-weak");
    strengthColor = "#ff4444";
  } else if (strength <= 2) {
    strengthLevel = "Weak";
    strengthFill.classList.add("strength-weak");
    strengthColor = "#ff4444";
  } else if (strength <= 3) {
    strengthLevel = "Fair";
    strengthFill.classList.add("strength-fair");
    strengthColor = "#ffaa00";
  } else if (strength <= 4) {
    strengthLevel = "Good";
    strengthFill.classList.add("strength-good");
    strengthColor = "#00aa00";
  } else {
    strengthLevel = "Strong";
    strengthFill.classList.add("strength-strong");
    strengthColor = "#00ff00";
  }
  
  // Update text
  if (feedback.length > 0) {
    strengthText.textContent = `${strengthLevel} - Missing: ${feedback.join(", ")}`;
  } else {
    strengthText.textContent = `${strengthLevel} - All requirements met!`;
  }
  strengthText.style.color = strengthColor;
}

function get_password_strength() {
  const password = get_password();
    if (!password) return null;
    const { strength, feedback } = checkPasswordStrength(password);
    return { strength, feedback };
}

function togglePasswordVisibility() {
  const passwordInput = document.getElementById("password");
  const toggleIcon = document.getElementById("password-toggle-icon");
  const isPassword = passwordInput.type === "password";
  
  // Toggle input type
  passwordInput.type = isPassword ? "text" : "password";
  
  // Update icon
  if (isPassword) {
    // Show "eye-off" icon when password is visible
    toggleIcon.innerHTML = `
      <path d="m1 1 22 22"/>
      <path d="M6.71 6.71C4.22 8.04 1 12 1 12s5.63 7.96 11 7.96c1.4 0 2.74-.2 3.93-.57"/>
      <path d="M10 10a3 3 0 1 0 6 6l-6-6z"/>
      <path d="M13.76 13.76a3 3 0 0 0-3.76-3.76"/>
    `;
  } else {
    // Show "eye" icon when password is hidden
    toggleIcon.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    `;
  }
}

// Initialize password strength checker when the component loads
document.addEventListener("DOMContentLoaded", function() {
  const passwordInput = document.getElementById("password");
  const passwordToggle = document.getElementById("password-toggle");
  
  if (passwordInput) {
    passwordInput.addEventListener("input", updatePasswordStrength);
    passwordInput.addEventListener("keyup", updatePasswordStrength);
  }
  
  if (passwordToggle) {
    passwordToggle.addEventListener("click", togglePasswordVisibility);
  }
});