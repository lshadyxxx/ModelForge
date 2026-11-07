import {createContext, useContext, type ReactNode} from 'react';
import {useDiagnosis} from './use-diagnosis';

export type DiagnosisView = ReturnType<typeof useDiagnosis>;

const DiagnosisContext = createContext<DiagnosisView | null>(null);

export function DiagnosisProvider({
  attemptId,
  children,
}: {
  attemptId: string;
  children: ReactNode;
}) {
  const diagnosis = useDiagnosis(attemptId);
  return <DiagnosisContext.Provider value={diagnosis}>{children}</DiagnosisContext.Provider>;
}

export function useDiagnosisView(): DiagnosisView {
  const diagnosis = useContext(DiagnosisContext);
  if (!diagnosis) {
    throw new Error('useDiagnosisView must be used inside DiagnosisProvider');
  }
  return diagnosis;
}
