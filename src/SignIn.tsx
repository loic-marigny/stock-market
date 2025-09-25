import { useState } from 'react'
import { auth, db } from './firebase'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'

type Mode = 'in' | 'up'

function authMessage(code: string, fallback: string){
  const map: Record<string, string> = {
    'auth/invalid-email': 'Invalid email address.',
    'auth/missing-password': 'Password required.',
    'auth/weak-password': 'Password too short (min 6 characters).',
    'auth/email-already-in-use': 'Email already in use.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
  }
  return map[code] || fallback
}

export default function SignIn(){
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
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!email || !pw) { setErr('Please enter your email and password.'); return }
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
            <h1>Stock&nbsp;Market</h1>
            <p>Practice investing with virtual credits</p>
          </div>

          <h2 className="signin-title">{mode === 'in' ? 'Sign in' : 'Create an account'}</h2>

          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email"
            value={email} onChange={e=>setEmail(e.target.value)} />

          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete={mode==='in'?'current-password':'new-password'}
            value={pw} onChange={e=>setPw(e.target.value)} />

          <div style={{marginTop:16}}>
            <button className="btn btn-accent" disabled={loading}>
              {mode === 'in' ? 'Sign in' : 'Create my account'}
            </button>
          </div>

          <div className="actions">
            <span style={{color:'var(--text-muted)'}}>
              {mode === 'in' ? 'New here?' : 'Already registered?'}
            </span>
            <button type="button" className="link"
              onClick={()=>setMode(mode==='in'?'up':'in')}>
              {mode === 'in' ? 'Create an account' : 'Sign in'}
            </button>
          </div>

          {err && <div className="error" role="alert">{err}</div>}
        </form>
      </div>
      {/* Footer dedicated to the sign-in page */}
      <footer className="signin-footer">
        <div className="inner">
          <span className="copy">&copy; {year} Stock Market - all rights reserved</span>
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


