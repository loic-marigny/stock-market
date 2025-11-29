import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { auth } from "./firebase";
import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import Explore from "./routes/Explore";
import Portfolio from "./routes/Portfolio";
import Trade from "./routes/Trade";
import SignIn from "./SignIn";
import { usePortfolioSnapshot } from "./lib/usePortfolioSnapshot";
import { useI18n } from "./i18n/I18nProvider";
import LanguageSwitcher from "./components/LanguageSwitcher";
import LoadingScreen from "./components/LoadingScreen";
import InitialLoader from "./components/InitialLoader";

const LOADING_FRAMES = ["", ".", "..", "..."];

export default function App(){
  const { t } = useI18n();
  const [user, setUser] = useState<User|null>(null);
  const [ready, setReady] = useState(false);
  useEffect(()=> onAuthStateChanged(auth, u => { setUser(u); setReady(true); }), []);

  const uid = user?.uid ?? null;
  const { totalValue, loadingInitial, loadingPrices } = usePortfolioSnapshot(uid);
  const currencyFmt = useMemo(() => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }), []);
  const isGlobalLoading = loadingInitial || loadingPrices;
  const [loadingFrame, setLoadingFrame] = useState(0);
  useEffect(() => {
    if (!isGlobalLoading) {
      setLoadingFrame(0);
      return;
    }
    const id = window.setInterval(() => {
      setLoadingFrame((prev) => (prev + 1) % LOADING_FRAMES.length);
    }, 500);
    return () => window.clearInterval(id);
  }, [isGlobalLoading]);
  const animatedLabel = useMemo(() => {
    if (!isGlobalLoading) return "";
    const base = t('app.calculating').replace(/\.+$/, "").trimEnd();
    const suffix = LOADING_FRAMES[loadingFrame];
    return suffix ? `${base}${suffix}` : base;
  }, [isGlobalLoading, loadingFrame, t]);
  const totalDisplay = isGlobalLoading ? animatedLabel : currencyFmt.format(totalValue);
  const showGlobalLoader = Boolean(user && isGlobalLoading);

  function TopbarCash(){
    const uid = auth.currentUser?.uid;
    const { cash } = usePortfolioSnapshot(uid || "");
    const formatted = cash.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return (
      <span className="topbar-metric">
        {isGlobalLoading ? animatedLabel : t('nav.availableCash', { amount: formatted })}
      </span>
    );
  }

  if(!ready) return <InitialLoader label={t('app.loading')} />;
  if(!user) return <SignIn/>;

  return (
    <div className="app-shell">
      {showGlobalLoader && <LoadingScreen message={t('app.loading')} />}
      <header className="topbar">
        <a href="https://loic-marigny.github.io/stock-market/" className="brand-mini">xMarket</a>
        <LanguageSwitcher />
        <nav className="nav">
          <NavLink to="/" end className={({isActive})=> isActive?"active":""}>{t('nav.explore')}</NavLink>
          <NavLink to="/portfolio" className={({isActive})=> isActive?"active":""}>{t('nav.portfolio')}</NavLink>
          <NavLink to="/trade" className={({isActive})=> isActive?"active":""}>{t('nav.trade')}</NavLink>
        </nav>
        <div className="topbar-right">
          <div className="topbar-metrics">
            <span className={`topbar-metric${isGlobalLoading ? " pulsating" : ""}`}>
              {t('nav.totalValueLabel')}: {totalDisplay}
            </span>
            <span className="topbar-separator" aria-hidden="true">·</span>
            <TopbarCash />
          </div>
          <button className="btn" onClick={()=>signOut(auth)}>{t('nav.signOut')}</button>
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


