// "/sign-in": sign in or create an account, then return to ?next= (or the map).
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { AuthForm } from '../account/AuthForm.tsx';
import { safeNext } from '../app/guards.tsx';
import { useSession } from '../session/useSession.ts';

export function SignInPage() {
  const auth = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  if (auth.kind === 'signed-in') {
    return <Navigate to={next} replace />;
  }
  return (
    <>
      <AuthForm onDone={() => void navigate(next, { replace: true })} />
      <Link to="/" className="link">
        ← Back to the map
      </Link>
    </>
  );
}
