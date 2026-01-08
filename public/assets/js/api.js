/**
 * RatoEngine Admin - API Client
 */

const API = {
    baseUrl: '',

    async request(method, endpoint, data = null) {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        };

        if (data) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(this.baseUrl + '/api' + endpoint, options);
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Request failed');
        }

        return result;
    },

    async get(endpoint) {
        return this.request('GET', endpoint);
    },

    async post(endpoint, data) {
        return this.request('POST', endpoint, data);
    },

    async put(endpoint, data) {
        return this.request('PUT', endpoint, data);
    },

    async delete(endpoint) {
        return this.request('DELETE', endpoint);
    },

    async login(username, password) {
        try {
            return await this.post('/auth/login', { username, password });
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    async logout() {
        try {
            await this.post('/auth/logout');
        } catch (e) { }
        document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    },

    async checkAuth() {
        try {
            await this.get('/auth/me');
            return true;
        } catch (e) {
            return false;
        }
    }
};
