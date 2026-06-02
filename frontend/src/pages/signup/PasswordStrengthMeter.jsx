import React from 'react';
import { motion } from 'framer-motion';

function PasswordStrengthMeter({ passwordState }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-700">Força da senha</p>
        <p className={`text-sm font-semibold ${passwordState.textColor}`}>
          {passwordState.label}
        </p>
      </div>

      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
        <motion.div
          className={`h-full ${passwordState.barColor}`}
          initial={false}
          animate={{ width: `${passwordState.progress}%` }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        />
      </div>

      <ul className="mt-3 grid sm:grid-cols-2 gap-2">
        {passwordState.checks.map((rule) => (
          <li
            key={rule.id}
            className={`text-xs flex items-center gap-2 ${
              rule.met ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${rule.met ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            {rule.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PasswordStrengthMeter;
