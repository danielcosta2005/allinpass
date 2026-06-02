import React from 'react';

function SignupProgressSteps({ activeStep, finishedFlow, paidPlan, steps }) {
  return (
    <div className="mb-8">
      <ol className={`grid grid-cols-1 ${paidPlan ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3`}>
        {steps.map((stepLabel, index) => {
          const position = index + 1;
          const isPasswordStep =
            finishedFlow === 'create-password' || finishedFlow === 'set-password';
          const isWaitingEmailFlow = finishedFlow === 'confirm-email';
          const isSuccessFlow = Boolean(finishedFlow) && !isPasswordStep && !isWaitingEmailFlow;
          const done = activeStep > position || isSuccessFlow;
          const current = (!finishedFlow || isPasswordStep) && activeStep === position;

          return (
            <li
              key={stepLabel}
              className={`rounded-2xl border p-3 transition-colors ${
                done
                  ? 'border-emerald-200 bg-emerald-50'
                  : current
                    ? 'border-purple-200 bg-purple-50'
                    : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    done
                      ? 'bg-emerald-500 text-white'
                      : current
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {done ? 'OK' : position}
                </span>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Etapa {position}</p>
                  <p className="font-semibold text-slate-900">{stepLabel}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default SignupProgressSteps;
