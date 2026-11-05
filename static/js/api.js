/* Общий клиент API для витрины и CRM */
(function () {
    const API_BASE = '/api/v1';

    function getCookie(name) {
        const match = document.cookie.match(
            new RegExp('(^|;\\s*)' + name + '=([^;]*)')
        );
        return match ? decodeURIComponent(match[2]) : null;
    }

    function extractError(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        if (data.detail) {
            return Array.isArray(data.detail) ? data.detail.join(' ') : data.detail;
        }
        if (data.error) {
            return Array.isArray(data.error) ? data.error.join(' ') : data.error;
        }
        if (Array.isArray(data)) {
            return data.map(extractError).filter(Boolean).join(' ');
        }
        if (typeof data === 'object') {
            const parts = [];
            Object.keys(data).forEach(function (key) {
                const value = data[key];
                if (Array.isArray(value)) parts.push(value.join(' '));
                else if (typeof value === 'string') parts.push(value);
                else if (value && typeof value === 'object') parts.push(extractError(value));
            });
            return parts.filter(Boolean).join(' ');
        }
        return '';
    }

    async function request(path, options) {
        options = options || {};
        const method = (options.method || 'GET').toUpperCase();
        const headers = Object.assign(
            { Accept: 'application/json' },
            options.headers || {}
        );

        const fetchOptions = {
            method: method,
            headers: headers,
            credentials: 'same-origin',
        };

        if (options.body !== undefined && options.body !== null) {
            if (options.body instanceof FormData) {
                fetchOptions.body = options.body;
            } else {
                headers['Content-Type'] = 'application/json';
                fetchOptions.body = JSON.stringify(options.body);
            }
        }

        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            const token = getCookie('csrftoken');
            if (token) headers['X-CSRFToken'] = token;
        }

        let response;
        try {
            response = await fetch(API_BASE + path, fetchOptions);
        } catch (networkError) {
            const error = new Error('Нет связи с сервером. Проверьте, запущен ли Django.');
            error.status = 0;
            throw error;
        }

        const contentType = response.headers.get('content-type') || '';
        let data = null;
        if (contentType.includes('application/json')) {
            data = await response.json().catch(function () { return null; });
        } else {
            data = await response.text();
        }

        if (!response.ok) {
            const message = extractError(data) || ('Ошибка запроса (' + response.status + ')');
            const error = new Error(message);
            error.status = response.status;
            error.data = data;
            throw error;
        }

        return data;
    }

    function formatNumber(value, digits) {
        const number = Number(value) || 0;
        const fractionDigits = digits === undefined
            ? (Number.isInteger(number) ? 0 : 2)
            : digits;
        return number.toLocaleString('ru-RU', {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        });
    }

    function formatMoney(value, currency) {
        return formatNumber(value) + ' ' + (currency || 'сом');
    }

    function formatDate(value, withTime) {
        if (!value) return '—';
        const date = new Date(value);
        if (isNaN(date.getTime())) return '—';
        const options = {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        };
        if (withTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }
        return date.toLocaleString('ru-RU', options);
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    window.API = {
        base: API_BASE,
        request: request,
        get: function (path, headers) {
            return request(path, { headers: headers });
        },
        post: function (path, body, headers) {
            return request(path, { method: 'POST', body: body, headers: headers });
        },
        patch: function (path, body, headers) {
            return request(path, { method: 'PATCH', body: body, headers: headers });
        },
        put: function (path, body, headers) {
            return request(path, { method: 'PUT', body: body, headers: headers });
        },
        delete: function (path) {
            return request(path, { method: 'DELETE' });
        },
    };

    window.fmt = {
        number: formatNumber,
        money: formatMoney,
        date: formatDate,
        html: escapeHtml,
    };
})();
