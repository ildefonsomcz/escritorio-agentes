import { describe, expect, it } from 'vitest';
import { cleanCena } from './cena';

describe('cena da Manu', () => {
  it('limpa o corpo e descarta itens sem slug', () => {
    const out = cleanCena({ cena: [{ slug: 'scooby', nome: 'Scooby', lugar: 'Lounge', atividade: 'Vendo TV', com: ['Salsicha', 3], dormindo: true }, { nome: 'sem slug' }] });
    expect(out).toEqual([{ slug: 'scooby', nome: 'Scooby', lugar: 'Lounge', atividade: 'Vendo TV', roda: null, com: ['Salsicha'], fala: '', dormindo: true, modo: '' }]);
    expect(cleanCena({})).toBeNull();
  });
});
