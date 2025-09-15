import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth, db } from './firebase'
import { doc, getDoc } from 'firebase/firestore'
import SignIn from './SignIn'

export default function App(){
  const [user, setUser] = useState<User|null>(null)
  const [ready, setReady] = useState(false)
  const [initialCredits, setInitialCredits] = useState<number|undefined>(undefined)

  useEffect(()=> onAuthStateChanged(auth, async (u)=>{
    setUser(u); setReady(true)
    if(u){
      const snap = await getDoc(doc(db,'users',u.uid))
      setInitialCredits(snap.exists() ? (snap.data().initialCredits ?? 100) : 100)
    }
  }), [])

  if(!ready) return <p style={{color:'#fff',textAlign:'center',marginTop:40}}>Chargement…</p>
  if(!user) return <SignIn/>

  return (
    <div className="auth-wrap">
      <div className="card">
        <h2 style={{marginTop:0}}>Bienvenue, {user.email}</h2>
        <p>Crédits initiaux : <strong>{initialCredits ?? 100}</strong></p>
        <p style={{color:'var(--text-muted)'}}>Prochaine étape : écran “Acheter / Vendre”.</p>
        <div style={{display:'flex', gap:8}}>
          <button className="btn btn-accent" onClick={()=>signOut(auth)}>Se déconnecter</button>
        </div>
      </div>
    </div>
  )
}
