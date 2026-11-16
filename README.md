# Diário Miccional

App simples para quem faz **sondagem de alívio** (cateterismo intermitente) registrar cada coleta: volume aproximado, data e hora. Tem histórico, gráficos e lembretes.

Funciona no navegador e pode ser **instalado na tela inicial** do celular (PWA). Depois de aberto uma vez, funciona offline.

## O que faz

- **Registrar**: volume com botões grandes (+/− 50 ml e valores rápidos), hora já preenchida, e detalhes opcionais (perda/escape, aspecto da urina, observação). Dá pra desfazer logo depois de salvar.
- **Histórico**: registros agrupados por dia, com total e quantidade. Dá pra editar e apagar.
- **Meta de média**: destaque da média por sondagem com meta (padrão: abaixo de 400 ml, ajustável). Verde quando está dentro, laranja quando passa, com gráfico da média dia a dia.
- **Gráficos** (7, 14 ou 30 dias): média por sondagem, sondagens por dia, intervalo médio, total por dia, maior volume, registros com perda. Mostra o volume por dia, o volume de cada sondagem (com linha do máximo indicado pelo médico, se você preencher) e os horários.
- **Lembretes** (opcionais):
  - *A cada X horas* depois da última sondagem, dentro de uma faixa de horário (ex.: 7h às 23h), ou *horários fixos*.
  - Com o app aberto: aviso na tela, som e vibração. Com notificação permitida, avisa também quando o app está em segundo plano.
  - **Criar alarmes na agenda do celular**: gera um arquivo `.ics` com eventos diários e alarme. É o jeito mais confiável de ser lembrado com o app fechado.
- **Seus dados**: exportar planilha CSV (abre no Excel/Google Planilhas, boa para levar ao médico), fazer backup e restaurar.

## Privacidade

Nada sai do aparelho. Não tem conta nem servidor: os registros ficam no armazenamento do navegador. Por isso, **faça backup de vez em quando**. Se limpar os dados do navegador ou trocar de celular, restaure o backup.

## Limitação dos lembretes

Navegadores não deixam um site/PWA tocar alarme agendado com o app totalmente fechado (isso exigiria um servidor de notificações). Por isso existe o botão de alarmes na agenda.

## Publicar (GitHub Pages)

1. No GitHub: **Settings › Pages › Build and deployment › Source: GitHub Actions**.
2. Faça merge na branch `main`. O workflow `.github/workflows/pages.yml` publica sozinho.
3. O endereço fica algo como `https://<usuario>.github.io/maxmix/`.

Para instalar no celular: abra o endereço → no Android, menu ⋮ › *Instalar app*; no iPhone (Safari), Compartilhar › *Adicionar à Tela de Início*.

## Rodar localmente

```bash
python3 -m http.server 8000
```

Depois abra `http://localhost:8000`.

## Estrutura

```
index.html            telas
css/app.css           visual (claro/escuro automático, letras maiores opcional)
js/app.js             lógica: registros, gráficos, lembretes, exportação
sw.js                 offline + toque na notificação abre o app
manifest.webmanifest  dados de instalação
icons/                ícones
```

> Este app é uma ferramenta de registro. Não substitui orientação médica.
