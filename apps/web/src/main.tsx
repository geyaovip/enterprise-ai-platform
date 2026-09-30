if (document.documentElement.dataset.page === 'app') {
  void Promise.all([
    import('react'),
    import('react-dom/client'),
    import('react-router-dom'),
    import('./App'),
    import('./styles.css'),
  ]).then(([React, { createRoot }, { BrowserRouter }, { App }]) => {
    const root = document.getElementById('root');
    if (root) createRoot(root).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
  });
}
