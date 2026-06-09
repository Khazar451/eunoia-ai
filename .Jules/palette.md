## 2024-05-24 - Screen Reader Compatibility with Error States
**Learning:** In dynamic web applications, when elements such as error messages appear asynchronously, screen readers may miss them if `role="alert"` and `aria-live` attributes are not explicitly set.
**Action:** Always ensure that dynamic notification or error elements that are inserted or made visible without page reloads contain `role="alert"` and `aria-live="assertive"` so that assistive technologies announce them properly.
