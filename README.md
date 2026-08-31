# ROM Nostalg

Emulador de Super Nintendo para o navegador, publicado no GitHub Pages. O jogador pode escolher uma ROM local, abrir o catálogo criptografado ou convidar outra pessoa para controlar o jogador 2. O [EmulatorJS 4.2.3](https://emulatorjs.org/) executa o jogo no dispositivo do host.

## Usar

1. Abra o site.
2. Clique em **Escolher ROM** ou arraste uma ROM para a área indicada.
3. Use uma ROM `.sfc`, `.smc`, `.fig` ou `.swc`; arquivos `.zip`, `.7z` e `.rar` também são aceitos.
4. Pressione `F11` ou use **Tela cheia**. `Esc` sai da tela cheia.

Controles PlayStation, Xbox e controles USB genéricos compatíveis com a Gamepad API são reconhecidos pelo navegador. Depois de conectar, pressione um botão para ativá-lo. O botão de controle do EmulatorJS permite conferir ou ajustar o mapeamento.

Quando o emulador termina de iniciar, o primeiro controle detectado é associado automaticamente ao jogador 1 caso nenhuma associação manual já exista. Isso corrige o caso em que o controle aparece nas configurações, mas não comanda o jogo.

Os quatro botões principais seguem a **posição do SNES**, tanto no jogo local quanto no convidado: embaixo = B, direita = A, esquerda = Y e cima = X. Assim, no PS4, ×/○/□/△ correspondem a B/A/Y/X; no Xbox, A/B/X/Y correspondem a B/A/Y/X. Isso pressupõe que o navegador reconheça o controle com `mapping: "standard"`; controles genéricos sem esse padrão podem exigir ajuste manual. L/R, Start, Select, direcional e teclado permanecem iguais. Configurações salvas com o quarteto padrão antigo são corrigidas uma vez; quartetos personalizados são preservados.

> A ROM permanece em memória nesta aba. Reiniciar o jogo pela barra do emulador reutiliza o arquivo selecionado; atualizar ou fechar a página exige escolhê-lo novamente por uma limitação de segurança do navegador. A página avisa antes de um recarregamento acidental.

### Perfis de controle no navegador

As alterações feitas na configuração original do controle são salvas em
`localStorage`, na chave `rom-nostalg.control-profiles.v1`, e têm prioridade sobre
o cache antigo por jogo. O teclado do jogador local é compartilhado entre todos
os jogos e o convidado. As teclas adicionais dos jogadores 2–4 do host também
persistem entre jogos, separadamente, para evitar acionar vários jogadores com
as mesmas teclas.

Cada gamepad tem um perfil pelo `Gamepad.id` e pelo tipo de mapeamento informado
pelo navegador; o índice temporário de conexão não faz parte do perfil. PS4 e
Xbox não compartilham alterações. Ao conectar um modelo sem perfil, aplica-se o
padrão. **Resetar** restaura os padrões; **Limpar** salva os comandos vazios.
Perfis de controles desconectados são preservados. Um perfil criado no host
também vale para aquele controle no convidado, e vice-versa, no mesmo navegador
e origem. Limpar os dados do site remove esses perfis.

O navegador identifica o modelo, não o número de série: dois controles que
informem o mesmo ID e mapeamento compartilham o perfil. USB e Bluetooth podem
informar IDs diferentes. Preferências antigas de teclado são aproveitadas uma
vez quando ainda não há perfil; mapas antigos de gamepad sem identificação
permanecem no cache antigo, mas não são atribuídos automaticamente a outro
controle. Configure o gamepad conectado uma vez para criar seu perfil.

Os demais ajustes e saves do emulador não mudam. Se o navegador bloquear a
gravação, a configuração permanece ativa na sessão, sem garantia após fechar
a aba.

## Multiplayer remoto

O host abre uma ROM de dois jogadores, seleciona **Multiplayer**, cria a sala e envia o link secreto. O convidado abre o link no Chrome ou Edge, seleciona **Entrar na sala** e usa teclado, o primeiro gamepad conectado ou os controles por toque no celular. O controle remoto é aplicado somente ao jogador 2; a ROM e a senha do catálogo nunca são enviadas ao convidado.

No convite, **Entrar na sala** e **Sair** ficam centralizados abaixo da mensagem de espera, nessa ordem, no desktop e no celular. Quando o vídeo chega, **Sair** fica abaixo do player para não cobrir o jogo. Se o navegador bloquear a reprodução, **Ativar áudio** aparece sobre o vídeo, também acessível em tela cheia.

A transmissão captura a saída final de áudio do OpenAL, preservando a saída local do host e o estéreo. Isso evita perder o som quando o núcleo refaz as conexões das fontes individuais. Os testes de áudio medem a energia recebida via WebRTC antes e depois dessa reconexão, com a política de autoplay do navegador ativa.

No desktop, o player do convidado segue o menu do host: a barra começa oculta, aparece ao clicar no vídeo ou mover o mouse para baixo e recolhe após três segundos sem interação. Ela contém somente configuração de controle, som/volume e tela cheia, com os mesmos ícones, dicas e estados visuais do EmulatorJS 4.2.3. O mapeamento usa os perfis de teclado/gamepad descritos acima; o volume continua salvo no navegador do convidado.

O painel **Configurações do Controle** abre sobre o vídeo, inclusive em tela cheia, com um único jogador e seleção do controle conectado. **Definir** captura uma tecla, botão ou eixo; **Limpar** apaga os comandos e **Resetar** restaura o padrão. Enquanto o painel está aberto, os comandos não são enviados ao host.

Em dispositivos com tela sensível ao toque, o controle virtual aparece automaticamente, inclusive dentro da tela cheia. Na vertical, fica abaixo do vídeo; na horizontal, sobre a transmissão. A barra de configuração desktop fica oculta e tocar no vídeo não a abre. **Tela cheia / Sair da tela cheia** fica fora da área de jogo, acessível nas duas orientações. O direcional aceita diagonais e pode ser usado junto com os botões A/B/X/Y, L/R, Start e Select. Toques são liberados ao girar a tela, trocar de aplicativo ou perder a conexão, evitando comandos presos.

Os ícones do menu são do Font Awesome Free ([CC BY 4.0](https://fontawesome.com/license/free)), os mesmos usados pelo EmulatorJS 4.2.3; estão em `site/assets/guest-menu-icons.svg` com a atribuição da origem.

O controle por toque reutiliza o layout, o direcional contínuo e os estilos
originais do host, extraídos do EmulatorJS 4.2.3. A origem, a licença GPL-3.0 e o
procedimento de reprodução estão em `site/vendor/emulatorjs/4.2.3/README.md`.
O adaptador do convidado envia somente comandos SNES ao jogador 2; ele não
carrega outra ROM ou instância do emulador.

Áudio, vídeo e controles usam WebRTC. O Worker `rom-nostalg-netplay` encaminha apenas presença e sinalização; quando a conexão direta não é possível, o Cloudflare TURN retransmite o tráfego WebRTC já criptografado. A aplicação admite um host e um convidado, sem matchmaking, contas, chat ou espectadores. Safari e Firefox ainda não foram validados.

O link usa um fragmento `#room=...&token=...`. Não remova esse fragmento nem publique o link: quem o possuir poderá ocupar a vaga do convidado enquanto a sala estiver ativa.

## Rodar localmente

Sirva a pasta `site` por HTTP; abrir o HTML diretamente como `file://` pode impedir o carregamento do WebAssembly.

```powershell
python -m http.server 8000 --directory site
```

Depois acesse `http://localhost:8000`. Para habilitar multiplayer local, copie `worker/.dev.vars.example` para `worker/.dev.vars` e preencha as credenciais de desenvolvimento:

```dotenv
TURN_KEY_ID="id-da-chave-turn"
TURN_KEY_API_TOKEN="token-da-chave-turn"
TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA"
```

O arquivo é ignorado pelo Git. A configuração não secreta do Worker define `ALLOWED_ORIGINS`, `ROOM_TTL_SECONDS=21600` (seis horas) e `TURN_CREDENTIAL_TTL_SECONDS=21600`. O Worker limita cada credencial temporária TURN ao tempo restante da sala. Em outro terminal:

```powershell
Set-Location worker
npm ci
npx wrangler dev
```

Crie também o arquivo ignorado `site/netplay-config.js`, apontando o frontend local para o Wrangler e usando a site key pública do Turnstile:

```javascript
window.ROM_NOSTALG_NETPLAY_CONFIG = Object.freeze({
  apiUrl: "http://localhost:8787",
  turnstileSiteKey: "1x00000000000000000000AA",
});
```

O workflow de produção exige HTTPS, mas o frontend aceita HTTP em `localhost` para desenvolvimento. Esses dois valores Turnstile são as chaves oficiais de teste que sempre aprovam; nunca os use no deploy de produção.

## Catálogo criptografado

A biblioteca mostra uma linha por jogo. A versão **Original** usa uma bandeira inferida pelas marcações de idioma/região no nome do arquivo: inglês usa Estados Unidos, japonês usa Japão, e francês, alemão, espanhol e italiano usam seus respectivos países. Marcações de tradução têm prioridade sobre a região de lançamento; edições europeias sem idioma específico e arquivos sem indicação reconhecida usam Estados Unidos como padrão. Isso não confirma o idioma de todo o conteúdo nem a procedência do dump. A bandeira do Brasil continua indicando a versão em português. Ao lado de **Jogar selecionado**, escolha **Original** ou **Traduzido**. A opção indisponível fica desabilitada, e a versão traduzida usa o botão verde-amarelo. Cada versão mantém seu próprio ID e seus saves; hacks como **Super Mario World Hack 2025** ficam separados do jogo base.

O gerador usa PBKDF2-SHA-256 com 600.000 iterações e AES-256-GCM. Os nomes ficam dentro do manifesto criptografado, cada ROM recebe um nome aleatório e é descriptografada apenas na memória do navegador. Os catálogos são separados por sistema em `site/vault/<sistema>`; atualmente somente `site/vault/snes` é consumido pelo site.

Defina a mesma senha forte usada pelo catálogo atual e execute o gerador sobre a pasta de saída existente:

```powershell
$catalogSecret = Read-Host "Senha forte do catálogo" -AsSecureString
try {
    $env:ROM_NOSTALG_PASSWORD = [System.Net.NetworkCredential]::new('', $catalogSecret).Password
    node tools/build-catalog.mjs --system snes ".\Top-100-snes" ".\site\vault\snes"
    if ($LASTEXITCODE -ne 0) { throw 'Falha na atualização do catálogo.' }
    node tools/verify-catalog.mjs ".\site\vault\snes"
    if ($LASTEXITCODE -ne 0) { throw 'Falha na verificação do catálogo.' }
} finally {
    $catalogSecret.Dispose()
    Remove-Item Env:ROM_NOSTALG_PASSWORD -ErrorAction SilentlyContinue
}
```

O gerador é incremental e trata a pasta de origem como a lista desejada: preserva ID, nome aleatório e bytes cifrados de ROMs inalteradas; cifra somente jogos novos ou modificados; reconhece renomeações pelo SHA-256; e remove do resultado assets de jogos retirados da origem. Não apague `site/vault/snes` antes de executá-lo, pois isso faria o gerador perder o estado incremental e recriar todo o catálogo.

O arquivo ignorado `Top-100-snes/.catalog-metadata.json` declara as versões explicitamente: `version: 1`, `games` indexado pelo nome completo do arquivo, e os campos `groupId`, `displayTitle` e `variant` (`original` ou `pt-BR`) em cada entrada. O gerador rejeita arquivos ausentes, grupos com títulos divergentes e versões duplicadas. Os nomes continuam dentro do manifesto cifrado, sem um índice público de títulos.

Para recuperar assets antigos, acrescente `--reuse-catalog <pasta-do-backup>` ao comando do gerador. A senha e os parâmetros de derivação precisam produzir a mesma chave do catálogo ativo. O gerador autentica o conteúdo recuperado e conserva seu ID, caminho e ciphertext; pacotes antigos com várias ROMs precisam ter apenas a edição escolhida extraída e compactada antes. Recuperar arquivos cifrados não dispensa a senha para atualizar o manifesto.

Depois da geração, confirme com `git status --short` que os arquivos `.bin` antigos não foram substituídos em massa. Uma execução sem mudanças não deve produzir diff. O primeiro uso sobre um catálogo legado atualiza apenas o pequeno manifesto e preserva os assets existentes.

A senha nunca é gravada no projeto: somente o manifesto e as ROMs já criptografadas são publicados. A pasta de origem `Top-100-snes` e as extensões de ROM permanecem ignoradas pelo Git. Consulte também o `AGENTS.md`, que registra este fluxo como regra permanente para futuras alterações automatizadas.

Mantenha uma versão por jogo, priorizando traduções em português já existentes e substituindo versões sem tradução quando houver uma equivalente em português. Não use compactados contendo várias revisões da mesma ROM. Para entradas novas ou substituídas, use ZIP com uma única ROM e verifique que os bytes descompactados são idênticos à fonte; compactar antes de cifrar reduz o tamanho do site e dos novos blobs do Git. Preserve os arquivos de entradas inalteradas, sem recompactá-los apenas para padronizar.

Como o GitHub Pages é estático, isto é criptografia, não controle de acesso: qualquer visitante pode baixar os arquivos cifrados e tentar descobrir a senha offline. Use uma senha longa, exclusiva e não a coloque no código, no histórico do Git ou no nome de arquivos.

## Configurar Cloudflare

Todos os recursos podem começar nas franquias gratuitas da Cloudflare. Não confirme upgrade nem adicione forma de pagamento para esta configuração.

1. No painel **Realtime → TURN**, crie a chave `rom-nostalg-turn`. Guarde o **TURN key ID** e o **API token**; eles servem para emitir credenciais temporárias e nunca devem ir ao navegador. Consulte [Generate Credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/).
2. Em **Turnstile**, crie o widget `rom-nostalg-room-create`, modo **Managed**, autorizando somente `malgany.github.io`. Use as chaves oficiais de teste acima para `localhost`. Guarde a site key pública e a secret key privada. Consulte [Create and manage widgets](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/).
3. Faça o primeiro deploy do Worker pelo workflow ou localmente com `npm run deploy` dentro de `worker`. O `wrangler.jsonc` publica `rom-nostalg-netplay` e registra a classe SQLite Durable Object `Room`.
4. Autenticado localmente com `npx wrangler login`, grave os secrets de runtime sem colocá-los no histórico do shell ou em arquivos versionados:

```powershell
Set-Location worker
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Cada comando solicita o valor de forma interativa. Um deploy posterior preserva esses secrets. Enquanto algum deles estiver ausente, os endpoints dependentes respondem `service_not_configured` sem expor qual credencial falta ao cliente.

O TURN inclui atualmente 1.000 GB mensais antes de cobrança e depois custa US$ 0,05/GB, conforme a [FAQ oficial](https://developers.cloudflare.com/realtime/turn/faq/). A aplicação não implementa uma trava de orçamento: acompanhe o consumo no painel e revogue/desative a chave TURN antes de exceder a franquia. STUN permanece gratuito e ilimitado.

## Configurar GitHub e publicar

Em **Settings → Secrets and variables → Actions**, crie:

| Tipo     | Nome                    | Conteúdo                                                                                                        |
| -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`  | Token restrito à conta, com permissão **Edit Cloudflare Workers**                                               |
| Secret   | `CLOUDFLARE_ACCOUNT_ID` | ID da conta Cloudflare                                                                                          |
| Variable | `NETPLAY_API_URL`       | URL HTTPS publicada, sem query ou fragmento, por exemplo `https://rom-nostalg-netplay.<subdominio>.workers.dev` |
| Variable | `TURNSTILE_SITE_KEY`    | Site key pública do widget Turnstile                                                                            |

Restrinja o API token à conta usada por este projeto. A Cloudflare documenta a autenticação de CI em [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/); a diferença entre variables e secrets está na [documentação do GitHub](https://docs.github.com/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables).

O workflow [`.github/workflows/worker.yml`](.github/workflows/worker.yml) executa `npm ci`, testes, verificação de tipos e um empacotamento Wrangler com `--dry-run` em pull requests. Em `main`, depois desses checks, executa `npm run deploy` com Wrangler. Os scripts `test`, `typecheck` e `deploy` são contratos obrigatórios de `worker/package.json`.

O workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) executa os testes unitários e o E2E Playwright com duas sessões Chromium antes de validar as duas variables públicas, gerar `site/netplay-config.js` somente no runner e publicar `site`. Nenhum secret Cloudflare entra no artefato do Pages. Em **Settings → Pages → Build and deployment**, selecione **GitHub Actions** como origem.

## Testar

Antes de publicar:

```powershell
npm ci
npx playwright install chromium
node --test site/tests/*.test.cjs
npm run test:catalog
npm run test:e2e

Set-Location worker
npm ci
npm test
npm run typecheck
```

Confira também, em Chrome ou Edge desktop:

- host e convidado em duas janelas, com uma ROM autorizada de dois jogadores;
- conexão direta e, em um teste separado, TURN forçado;
- teclado e gamepad do convidado controlando apenas o jogador 2;
- liberação dos botões ao desconectar, reconexão e encerramento da sala;
- catálogo, ROM local, saves, tela cheia e jogador 1 sem regressões;
- sessão com duração de pelo menos uma hora.

## Segurança, privacidade e direitos

- ROM, senha do catálogo e saves permanecem no dispositivo do host. O Worker recebe metadados de conexão e sinalização, mas não recebe esses arquivos.
- Tokens permanentes TURN e a secret key do Turnstile existem somente como secrets do Worker; o site recebe apenas credenciais TURN temporárias e a site key pública.
- CORS limita origens aceitas, mas não substitui autenticação. Tokens aleatórios da sala autorizam host e convidado.
- As ROMs-fonte não fazem parte do histórico público; o catálogo contém somente cópias criptografadas com nomes aleatórios.
- Não registre `.dev.vars`, links de convite, tokens, senhas ou saídas de comandos que revelem credenciais.
- Use e publique somente ROMs que você tem direito de utilizar e distribuir.
- O emulador é obtido do CDN oficial fixado na versão `4.2.3`; portanto, a primeira execução precisa de internet.
