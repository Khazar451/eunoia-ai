## 2024-05-18 - Missing Authentication on Admin Endpoints
**Vulnerability:** Admin routes (`/admin.html` and `/api/admin/*`) completely lacked authentication despite documentation stating they were protected by Basic Auth. Any user could access the dashboard and all chat logs.
**Learning:** Security controls described in documentation or instructions may not exist in the codebase. Always verify the implementation, especially for new admin/debug endpoints.
**Prevention:** Implement global authentication middleware for sensitive path prefixes early in development, and add automated tests verifying 401/403 responses for unauthenticated requests.
