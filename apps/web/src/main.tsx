if (document.documentElement.dataset.page === 'app') {
  // Keep the application's landmarks and anchor targets unique.
  document.getElementById('marketing')?.remove();
  void Promise.all([
    import('react'),
    import('react-dom/client'),
    import('react-router-dom'),
    import('./App'),
    import('./styles.css'),
  ]).then(([React, { createRoot }, { createBrowserRouter, RouterProvider }, { App }]) => {
    const root = document.getElementById('root');
    if (root) createRoot(root).render(<React.StrictMode><RouterProvider router={createBrowserRouter([{path:'*',element:<App/>}])}/></React.StrictMode>);
  });
}
