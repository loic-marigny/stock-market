import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { auth } from "./firebase";
import { Link, NavLink, Route, Routes, Navigate } from "react-router-dom";
import Explore from "./routes/Explore";
import Portfolio from "./routes/Portfolio";
import Trade from "./routes/Trade";
import SignIn from "./SignIn";
import { usePortfolioSnapshot } from "./lib/usePortfolioSnapshot";
import { useI18n } from "./i18n/I18nProvider";
import LanguageSwitcher from "./components/LanguageSwitcher";

export default function App(){
  const { t } = useI18n();
  const [user, setUser] = useState<User|null>(null);
  const [ready, setReady] = useState(false);
  useEffect(()=> onAuthStateChanged(auth, u => { setUser(u); setReady(true); }), []);

  const uid = user?.uid ?? null;
  const { totalValue, loadingInitial, loadingPrices } = usePortfolioSnapshot(uid);
  const currencyFmt = useMemo(() => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }), []);
  const totalDisplay = loadingInitial || loadingPrices ? t('app.calculating') : currencyFmt.format(totalValue);

  function TopbarCash(){
    const uid = auth.currentUser?.uid;
    const { cash } = usePortfolioSnapshot(uid || "");
    const formatted = cash.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return (
      <div aria-label={t('nav.availableCash', { amount: formatted })} className="topbar-cash">
        {t('nav.availableCash', { amount: formatted })}
      </div>
    );
  }

  if(!ready) return <p style={{color:"#fff",textAlign:"center",marginTop:40}}>{t('app.loading')}</p>;
  if(!user) return <SignIn/>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand-mini">Stock&nbsp;Market</Link>
        <LanguageSwitcher />
        <nav className="nav">
          <NavLink to="/" end className={({isActive})=> isActive?"active":""}>{t('nav.explore')}</NavLink>
          <NavLink to="/portfolio" className={({isActive})=> isActive?"active":""}>{t('nav.portfolio')}</NavLink>
          <NavLink to="/trade" className={({isActive})=> isActive?"active":""}>{t('nav.trade')}</NavLink>
        </nav>
        <div style={{marginLeft:"auto", display:"flex", alignItems:"center", gap:"1rem"}}>
          <div style={{color:"var(--text-muted)", fontSize:"0.9rem"}}>{t('nav.totalValueLabel')}: {totalDisplay}</div>
          <button className="btn" onClick={()=>signOut(auth)}>{t('nav.signOut')}</button>
        <TopbarCash />
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Explore />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}


