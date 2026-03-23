import { useState, useEffect, useRef } from 'react';
import config from '../config.json';
import './index.css';

function App() {
  const [goldData, setGoldData] = useState(null);
  const [error, setError] = useState(null);
  const [markups, setMarkups] = useState({ buy: 0, sell: 0 });
  const prevDataRef = useRef(null);

  // SSE Connection for Markups
  useEffect(() => {
    // Utilizing relative paths allows the browser to natively inherit the https:// protocol and host, completely bypassing Mixed Content blocks!
    let eventSource = new EventSource(`/events`);

    eventSource.onopen = () => console.log('Connected to Markup SSE over relative origin.');

    eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'MARKUP_UPDATE') {
          setMarkups({ buy: msg.buy, sell: msg.sell });
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
          const targetItem = data.items.find(item => item.code === "JZJ_au");
          if (targetItem) {
            setGoldData(targetItem);
            setError(null);
          } else {
            setError("未找到 JZJ_au 数据");
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
    if (goldData) {
      prevDataRef.current = goldData;
    }
  }, [goldData]);

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

  const getPriceColorStyle = () => {
    if (!goldData) return {};
    const open = goldData.open !== undefined ? goldData.open : goldData.openprice;
    if (open === undefined) return {};

    const salesPrice = applyMarkup(goldData.askprice, markups.sell);
    const openPrice = applyMarkup(open, markups.sell);
    if (salesPrice > openPrice) return { color: 'var(--danger)' };
    if (salesPrice < openPrice) return { color: 'var(--success)' };
    return { color: '#ffffff' };
  };

  const priceStyle = getPriceColorStyle();

  return (
    <div className="dashboard">
      <header className="header-bar">
        <div className="title-group">
          <h1>万泓贵金属</h1>
          <p>Wang Hong Precious Metals</p>
        </div>
        <div className="status-indicator">
          <div className="pulse"></div>
          {error ? '连接异常' : (goldData ? formatCurrentTime() : '连接中...')}
        </div>
      </header>

      {error && (
        <div className="center-message" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {!goldData && !error && (
        <div className="center-message">
          <div className="spinner"></div>
          <div>正在接入交易市场数据...</div>
        </div>
      )}

      {goldData && (
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
              <tr>
                <td>
                  <div className="col-product">
                    <span className="prod-name">{goldData.name || '黄金'}</span>
                  </div>
                </td>

                <td style={{ textAlign: 'right' }}>
                  <span className={`price-value ${getChangeClass(applyMarkup(goldData.bidprice, markups.buy), applyMarkup(prevData?.bidprice, markups.buy))}`} style={priceStyle} key={`buy-${goldData.bidprice}-${markups.buy}`}>
                    {applyMarkup(goldData.bidprice, markups.buy).toFixed(2)}
                  </span>
                </td>

                <td style={{ textAlign: 'right' }}>
                  <span className={`price-value ${getChangeClass(applyMarkup(goldData.askprice, markups.sell), applyMarkup(prevData?.askprice, markups.sell))}`} style={priceStyle} key={`sell-${goldData.askprice}-${markups.sell}`}>
                    {applyMarkup(goldData.askprice, markups.sell).toFixed(2)}
                  </span>
                </td>

                <td style={{ textAlign: 'right' }}>
                  <div className="high-low-group" style={{ alignItems: 'flex-end' }}>
                    <div className="hl-item">
                      <span className="hl-label">高</span>
                      <span className={`hl-val high ${getChangeClass(applyMarkup(goldData.high, markups.sell), applyMarkup(prevData?.high, markups.sell))}`} key={`high-${goldData.high}-${markups.sell}`}>
                        {applyMarkup(goldData.high, markups.sell).toFixed(2)}
                      </span>
                    </div>
                    <div className="hl-item">
                      <span className="hl-label">低</span>
                      <span className={`hl-val low ${getChangeClass(applyMarkup(goldData.low, markups.sell), applyMarkup(prevData?.low, markups.sell))}`} key={`low-${goldData.low}-${markups.sell}`}>
                        {applyMarkup(goldData.low, markups.sell).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </main>
      )}
    </div>
  );
}

export default App;
