try {
  const t = localStorage.getItem('inkadra.theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch {}
