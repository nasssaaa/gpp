import { useState, useEffect, useRef } from 'react';
import './index.css';

// Product definitions (must match server)
const PRODUCTS = [
  { key: 'au9999', name: '黄金9999', code: 'Au99.99' },
  { key: 'autd', name: '黄金T+D', code: 'Au(T+D)' },
  { key: 'au', name: '黄金', code: 'JZJ_au' },
  { key: 'ag', name: '白银', code: 'JZJ_ag' },
  { key: 'pt', name: '铂金', code: 'JZJ_pt' },
  { key: 'pd', name: '钯金', code: 'JZJ_pd' },
];

function initMarkups() {
  const m = {};
  PRODUCTS.forEach(p => { m[p.key] = { buy: 0, sell: 0 }; });
  return m;
}

function App() {
  const [productsData, setProductsData] = useState({});
  const [error, setError] = useState(null);
  const [markups, setMarkups] = useState(initMarkups);
  const prevDataRef = useRef({});

  // SSE Connection for Markups
  useEffect(() => {
    let eventSource = new EventSource(`/events`);

    eventSource.onopen = () => console.log('Connected to Markup SSE over relative origin.');

    eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'MARKUP_UPDATE' && msg.markups) {
          setMarkups(msg.markups);
        }
      } catch (e) { console.error('SSE Parse error', e); }
    };

    eventSource.onerror = () => console.log('Markup SSE connection lost.');

    return () => { eventSource.close(); };
  }, []);

  // API Polling Loop
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/res/quote/pq.json');
        const data = await response.json();

        if (data && data.items) {
          const newData = {};
          for (const product of PRODUCTS) {
            const item = data.items.find(i => i.code === product.code);
            if (item) {
              newData[product.key] = item;
            }
          }
          if (Object.keys(newData).length > 0) {
            setProductsData(newData);
            setError(null);
          } else {
            setError("未找到任何商品数据");
          }
        }
      } catch (err) {
        console.error("Fetch error:", err);
        setError("获取数据失败或发生网络错误");
      }
    };

    fetchData();
    const intervalId = setInterval(fetchData, 500);

    return () => clearInterval(intervalId);
  }, []);

  // Animation Trackers
  useEffect(() => {
    if (Object.keys(productsData).length > 0) {
      prevDataRef.current = { ...productsData };
    }
  }, [productsData]);

  const prevData = prevDataRef.current;

  const getChangeClass = (curr, prev) => {
    if (!prev) return '';
    const currVal = parseFloat(curr);
    const prevVal = parseFloat(prev);
    if (currVal > prevVal) return 'flash-up';
    if (currVal < prevVal) return 'flash-down';
    return '';
  };

  // Helper to safely add markup
  const applyMarkup = (basePrice, markupAmt) => {
    if (!basePrice) return 0;
    return parseFloat(basePrice) + (markupAmt || 0);
  };

  const formatCurrentTime = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dow = days[d.getDay()] + '.';
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd} ${dow} ${hh}:${min}:${ss}`;
  };

  const getPriceColorStyle = (itemData, productMarkups) => {
    if (!itemData) return {};
    const open = itemData.open !== undefined ? itemData.open : itemData.openprice;
    if (open === undefined) return {};

    const salesPrice = applyMarkup(itemData.askprice, productMarkups?.sell || 0);
    const openPrice = applyMarkup(open, productMarkups?.sell || 0);
    if (salesPrice > openPrice) return { color: 'var(--danger)' };
    if (salesPrice < openPrice) return { color: 'var(--success)' };
    return { color: '#ffffff' };
  };

  const hasData = Object.keys(productsData).length > 0;

  return (
    <div className="dashboard">
      <header className="header-bar">
        <div className="title-group">
          <h1>万泓贵金属</h1>
        </div>
        <div className="status-indicator">
          <div className="pulse"></div>
          {error ? '连接异常' : (hasData ? formatCurrentTime() : '连接中...')}
        </div>
      </header>

      {error && (
        <div className="center-message" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {!hasData && !error && (
        <div className="center-message">
          <div className="spinner"></div>
          <div>正在接入交易市场数据...</div>
        </div>
      )}

      {hasData && (
        <main className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>商品</th>
                <th style={{ textAlign: 'right' }}>回购 (Sell)</th>
                <th style={{ textAlign: 'right' }}>销售 (Buy)</th>
                <th style={{ textAlign: 'right' }}>高/低 (High/Low)</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map((product) => {
                const itemData = productsData[product.key];
                const prevItem = prevData[product.key];
                const productMarkups = markups[product.key] || { buy: 0, sell: 0 };
                const priceStyle = getPriceColorStyle(itemData, productMarkups);

                if (!itemData) return null;

                return (
                  <tr key={product.key}>
                    <td>
                      <div className="col-product">
                        <span className="prod-name">{product.name}</span>
                      </div>
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <span className={`price-value ${getChangeClass(applyMarkup(itemData.bidprice, productMarkups.buy), applyMarkup(prevItem?.bidprice, productMarkups.buy))}`} style={priceStyle} key={`buy-${product.key}-${itemData.bidprice}-${productMarkups.buy}`}>
                        {applyMarkup(itemData.bidprice, productMarkups.buy).toFixed(2)}
                      </span>
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <span className={`price-value ${getChangeClass(applyMarkup(itemData.askprice, productMarkups.sell), applyMarkup(prevItem?.askprice, productMarkups.sell))}`} style={priceStyle} key={`sell-${product.key}-${itemData.askprice}-${productMarkups.sell}`}>
                        {applyMarkup(itemData.askprice, productMarkups.sell).toFixed(2)}
                      </span>
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div className="high-low-group" style={{ alignItems: 'flex-end' }}>
                        <div className="hl-item">
                          <span className="hl-label">高</span>
                          <span className={`hl-val high ${getChangeClass(applyMarkup(itemData.high, productMarkups.sell), applyMarkup(prevItem?.high, productMarkups.sell))}`} key={`high-${product.key}-${itemData.high}-${productMarkups.sell}`}>
                            {applyMarkup(itemData.high, productMarkups.sell).toFixed(2)}
                          </span>
                        </div>
                        <div className="hl-item">
                          <span className="hl-label">低</span>
                          <span className={`hl-val low ${getChangeClass(applyMarkup(itemData.low, productMarkups.sell), applyMarkup(prevItem?.low, productMarkups.sell))}`} key={`low-${product.key}-${itemData.low}-${productMarkups.sell}`}>
                            {applyMarkup(itemData.low, productMarkups.sell).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </main>
      )}
    </div>
  );
}

export default App;
