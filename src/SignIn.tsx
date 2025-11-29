import { useState } from 'react'
import { auth, db } from './firebase'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useI18n } from './i18n/I18nProvider'
import type { TranslationKey } from './i18n/eng'
import { recordWealthSnapshot } from './lib/wealthHistory'

type Mode = 'in' | 'up'

const AUTH_ERROR_MAP: Partial<Record<string, TranslationKey>> = {
  'auth/invalid-email': 'auth.errors.invalidEmail',
  'auth/missing-password': 'auth.errors.missingPassword',
  'auth/weak-password': 'auth.errors.weakPassword',
  'auth/email-already-in-use': 'auth.errors.emailInUse',
  'auth/invalid-credential': 'auth.errors.invalidCredential',
  'auth/too-many-requests': 'auth.errors.tooManyRequests',
};

export default function SignIn(){
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')

  const ensureUserDoc = async (uid: string, email: string | null) => {
    const ref = doc(db, 'users', uid)
    const snap = await getDoc(ref)
    if (!snap.exists()) {
      await setDoc(ref, {
        email: email || '',
        initialCredits: 1_000_000,
        createdAt: serverTimestamp(),
      })
      recordWealthSnapshot(uid, { source: 'signup', snapshotType: 'scheduled' }).catch((error) => {
        console.error('Failed to seed wealth history', error)
      })
    }
  }

  const authMessage = (code: string, fallback: string) => {
    const key = AUTH_ERROR_MAP[code]
    return key ? t(key) : fallback
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!email || !pw) { setErr(t('auth.validation.missingCredentials')); return }
    setLoading(true)
    try{
      if(mode === 'up'){
        const cred = await createUserWithEmailAndPassword(auth, email, pw)
        await ensureUserDoc(cred.user.uid, cred.user.email)
      }else{
        const cred = await signInWithEmailAndPassword(auth, email, pw)
        await ensureUserDoc(cred.user.uid, cred.user.email)
      }
    }catch(e:any){
      setErr(authMessage(e?.code, e?.message ?? String(e)))
    }finally{
      setLoading(false)
    }
  }

  const year = new Date().getFullYear()

  return (
    <div className="signin-layout">
      <div className="signin-main">
        <form className="card signin-card" onSubmit={submit} aria-busy={loading}>
          <div className="brand">
            <h1>xMarket</h1>
            <p>{t('auth.subtitle')}</p>
          </div>

          <h2 className="signin-title">{t(mode === 'in' ? 'auth.title.signIn' : 'auth.title.createAccount')}</h2>

          <label htmlFor="email">{t('auth.label.email')}</label>
          <input id="email" type="email" autoComplete="email"
            value={email} onChange={e=>setEmail(e.target.value)} />

          <label htmlFor="pw">{t('auth.label.password')}</label>
          <input id="pw" type="password" autoComplete={mode==='in'?'current-password':'new-password'}
            value={pw} onChange={e=>setPw(e.target.value)} />

          <div style={{marginTop:16}}>
            <button className="btn btn-accent" disabled={loading}>
              {mode === 'in' ? t('auth.actions.signIn') : t('auth.actions.createMyAccount')}
            </button>
          </div>

          <div className="actions">
            <span style={{color:'var(--text-muted)'}}>
              {mode === 'in' ? t('auth.toggle.newHere') : t('auth.toggle.alreadyRegistered')}
            </span>
            <button type="button" className="link"
              onClick={()=>setMode(mode==='in'?'up':'in')}>
              {mode === 'in' ? t('auth.toggle.createAccount') : t('auth.toggle.signIn')}
            </button>
          </div>

          {err && <div className="error" role="alert">{err}</div>}
        </form>
      </div>
      {/* Footer dedicated to the sign-in page */}
      <footer className="signin-footer">
        <div className="inner">
          <span className="copy">{t('auth.footer.note', { year })}</span>
          <div className="links">
            <a href="https://github.com/loic-marigny/stock-market" aria-label="GitHub" target="_blank" rel="noreferrer">
              {/* Minimal GitHub icon */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .5a12 12 0 0 0-3.79 23.4c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.09-.74.09-.74 1.22.09 1.86 1.25 1.86 1.25 1.08 1.86 2.83 1.32 3.52 1.01.11-.8.42-1.32.76-1.63-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.48 11.48 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.63-5.47 5.92.43.38.82 1.12.82 2.26v3.35c0 .32.21.7.82.58A12 12 0 0 0 12 .5z"/>
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}



