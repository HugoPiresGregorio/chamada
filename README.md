# Sistema de Chamadas — Burle Marx & Perimetral

  ## Como usar no GitHub Pages

  ### 1. Configure o Supabase

  Edite config.js e coloque sua chave anônima (anon key):
  1. Acesse https://supabase.com/dashboard → seu projeto
  2. Settings → API → copie a chave "anon public"
  3. Substitua COLE_SUA_CHAVE_ANONIMA_AQUI pela chave copiada

  ### 2. Suba para o GitHub Pages

  1. Crie um repositório no GitHub
  2. Faça upload dos 4 arquivos (index.html, chamado.css, chamado.js, config.js)
  3. Settings → Pages → ative na branch main
  4. Acesse o link gerado

  ### 3. Tabela Supabase (se ainda não criou)

  Execute no SQL Editor do Supabase:

  CREATE TABLE IF NOT EXISTS chamadas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola TEXT NOT NULL,
    data DATE NOT NULL,
    turno TEXT NOT NULL,
    salas JSONB NOT NULL DEFAULT '{}',
    total_criancas INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(escola, data, turno)
  );

  ## Paleta de cores
  - #FC1B0F — Vermelho (Burle Marx)
  - #2897FC — Azul (Perimetral)
  - #EEFC38 — Amarelo (destaques)
  - #A86F6C — Mauve (neutro)
  - #05447D — Navy (cabeçalho)
  
