// 子頁面（成功、失敗、查詢）套用網站品牌：名稱、顏色
const brandReady = fetch('/api/config').then((r) => r.json()).then((c) => {
  const t = c.brand.theme, r = document.documentElement.style;
  if (!matchMedia('(prefers-color-scheme: dark)').matches) {
    const vars = { brand: t.brand, 'brand-dark': t.brandDark, 'brand-soft': t.brandSoft, cream: t.cream, bg: t.bg, 'hero-from': t.heroFrom, 'hero-to': t.heroTo };
    for (const [k, v] of Object.entries(vars)) r.setProperty('--' + k, v);
  } else r.setProperty('--brand', t.brand);
  const b = document.getElementById('brand');
  if (b) b.innerHTML = icon(c.brand.icon) + c.brand.name;
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = t.brand;
  return c;
}).catch(() => null);
