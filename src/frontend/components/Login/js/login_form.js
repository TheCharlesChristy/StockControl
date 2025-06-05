function getLoginFormData() {
    return {
        username: get_username(),
        password: get_password()
    }
}

function submitForm() {
    const formData = getLoginFormData();
    const url = '/api/login';

    // Check if the form data is valid
    if (!formData.username || !formData.password) {
        return;
    }

    console.log('Submitting form with data:', formData);
}