import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronUp, Cookie, Hand, Moon, Sun, Zap, Smile, Utensils, Volleyball } from 'lucide-react';
import { ageLabel, headline, level, needWord } from '@shared/pet';
import { Segmented } from '../components/ui';
import { Mascot } from '../mascot/Mascot';
import { useApp } from '../store';

const LEVEL_TONE = { great: '#4fb7a2', ok: '#a3e635', low: '#f2b84b', critical: '#f27479' } as const;

function Need({ icon, label, value, word }: { icon: React.ReactNode; label: string; value: number; word: string }) {
  const tone = LEVEL_TONE[level(value)];
  return (
    <div className="need" style={{ ['--tone' as string]: tone }} title={`${Math.round(value)} de 100`}>
      <span style={{ color: tone, display: 'grid' }}>{icon}</span>
      <span>{label}</span>
      <div className="need__bar">
        <div className="need__fill" style={{ width: `${Math.max(3, value)}%` }} />
      </div>
      <span className="need__word">{word}</span>
    </div>
  );
}

/** Faint concentric orbits behind Orbi — the Orbit symbol, used as a stage. */
const ORBITS = (
  <svg className="pet__orbits" viewBox="0 0 356 236" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <ellipse cx="178" cy="132" rx="150" ry="44" fill="none" stroke="rgba(126,213,195,0.07)" strokeWidth="1" />
    <ellipse cx="178" cy="132" rx="112" ry="32" fill="none" stroke="rgba(126,213,195,0.1)" strokeWidth="1" strokeDasharray="2 5" />
    <circle cx="46" cy="58" r="1.4" fill="rgba(229,234,230,0.5)" />
    <circle cx="300" cy="40" r="1.1" fill="rgba(229,234,230,0.4)" />
    <circle cx="318" cy="170" r="1.6" fill="rgba(163,230,53,0.45)" />
    <circle cx="70" cy="196" r="1.2" fill="rgba(94,234,212,0.45)" />
    <circle cx="250" cy="22" r="0.9" fill="rgba(229,234,230,0.35)" />
  </svg>
);

export function Pet() {
  const pet = useApp((s) => s.pet);
  const style = useApp((s) => s.settings.mascotStyle);
  const updateSettings = useApp((s) => s.updateSettings);
  const setView = useApp((s) => s.setView);
  const setTab = useApp((s) => s.setTab);
  const petAct = useApp((s) => s.petAct);
  const note = useApp((s) => s.petNote);
  const reaction = useApp((s) => s.reaction);
  const now = Date.now();

  const busy = reaction && reaction.until > now && ['feed', 'play'].includes(reaction.kind);

  return (
    <div className="pet">
      <div className="panel__head">
        <button className="icon-btn" aria-label="Voltar ao painel" title="Voltar ao painel" onClick={() => (setTab('home'), setView('panel'))}>
          <ChevronLeft size={16} />
        </button>
        <div className="panel__spacer" title="Arraste para mover" />
        <Segmented
          label="Estilo do Orbi"
          value={style}
          options={[
            { value: '2d', label: '2D' },
            { value: '3d', label: '3D' },
          ]}
          onChange={(v) => void updateSettings({ mascotStyle: v })}
        />
        <button className="icon-btn" aria-label="Recolher" title="Recolher (Esc)" onClick={() => setView('compact')}>
          <ChevronUp size={16} />
        </button>
      </div>

      <div className="pet__stage">
        {ORBITS}
        <Mascot size={208} stage />
      </div>

      <div className="pet__headline">{headline(pet)}</div>
      <div className="pet__age">{ageLabel(pet, now)}. Clique e esfregue o cursor nele para fazer carinho.</div>

      <div className="needs">
        <Need icon={<Utensils size={14} />} label="Fome" value={pet.satiety} word={needWord('satiety', pet.satiety)} />
        <Need icon={<Zap size={14} />} label="Energia" value={pet.energy} word={needWord('energy', pet.energy)} />
        <Need icon={<Smile size={14} />} label="Humor" value={pet.mood} word={needWord('mood', pet.mood)} />
      </div>

      <div className="care">
        <button className="care__btn" style={{ ['--tone' as string]: '#facc15' }} disabled={Boolean(busy)} onClick={() => petAct('feed')}>
          <Cookie size={18} />
          Alimentar
        </button>
        <button className="care__btn" style={{ ['--tone' as string]: '#5eead4' }} disabled={Boolean(busy)} onClick={() => petAct('play')}>
          <Volleyball size={18} />
          Brincar
        </button>
        <button className="care__btn" style={{ ['--tone' as string]: '#b794f6' }} aria-pressed={pet.sleeping} onClick={() => petAct('rest')}>
          {pet.sleeping ? <Sun size={18} /> : <Moon size={18} />}
          {pet.sleeping ? 'Acordar' : 'Descansar'}
        </button>
        <button className="care__btn" style={{ ['--tone' as string]: '#f472b6' }} onClick={() => petAct('pet')}>
          <Hand size={18} />
          Carinho
        </button>
      </div>

      <div className="pet__note" aria-live="polite">
        <AnimatePresence mode="wait">
          {note ? (
            <motion.span key={note.key} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {note.text}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
