// "/sign-in": sign in or create an account, then return to ?next= (or the map).
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { AuthForm, useSession } from '../features/auth/index.ts';
import { safeNext } from '../shared/lib/safeNext.ts';
import { ButtonLink, PageTitle } from '../shared/ui/index.ts';

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
      <PageTitle title="Sign in" />
      <AuthForm onDone={() => void navigate(next, { replace: true })} />
      <ButtonLink to="/" variant="link" className="back-to-cities">
        ← All cities
      </ButtonLink>
    </>
  );
}
