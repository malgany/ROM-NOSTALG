# Memória operacional do ROM Nostalg

## Catálogos criptografados

- Trate cada sistema como um catálogo independente: `site/vault/snes`, futuramente `site/vault/gb`, `site/vault/gba` e `site/vault/arcade`.
- O frontend atualmente usa somente `site/vault/snes`. Não publique um novo sistema sem também implementar e testar núcleo, extensões, controles, saves, interface e validação correspondentes.
- Nunca apague, esvazie, renomeie em massa ou recrie manualmente a pasta de um catálogo existente antes de atualizá-lo. Os assets cifrados existentes são o estado necessário para a atualização incremental.
- Nunca execute o gerador antigo de saída vazia nem escreva um segundo gerador improvisado. Use `tools/build-catalog.mjs` com `--system`.
- A pasta de ROMs-fonte deve ficar fora de `site`, permanecer ignorada pelo Git e conter a lista completa desejada para aquele sistema. O gerador remove do catálogo jogos ausentes nessa pasta.
- Passe a senha somente por `ROM_NOSTALG_PASSWORD`; nunca a coloque em argumentos, arquivos, logs, commits ou documentação.
- Mantenha no máximo uma versão original e uma tradução em português por jogo, conforme autorização do proprietário em 31/08/2026. Preserve a tradução existente; evite betas, dumps defeituosos e duplicatas regionais. Cada versão fica em seu próprio arquivo. Não agrupe continuações nem hacks de conteúdo diferente: `Super Mario World Hack 2025` é separado de `Super Mario World`.
- A pasta-fonte completa contém `.catalog-metadata.json` (version 1, games por fileName, com groupId, displayTitle e variant `original` ou `pt-BR`). Esse arquivo permanece ignorado junto das ROMs; seus dados entram no manifesto cifrado. Preserve o agrupamento explícito, sem deduzir identidade somente por nomes parecidos.
- Para recuperar ciphertext de um backup compatível, use o gerador oficial com `--reuse-catalog <pasta-do-backup>`. Ele exige a mesma chave derivada e autentica cada asset recuperado. A senha ainda é necessária para atualizar o manifesto. Não copie assets manualmente para o catálogo ativo.
- Não publique compactados com várias versões de ROM. Se um pacote antigo já contiver uma tradução em português, aproveite essa ROM sem alterar seus bytes e mantenha somente ela no novo compactado.
- Para entradas novas ou substituídas, prefira ZIP com exatamente uma ROM, compactado antes da criptografia. Confira integridade e hash do conteúdo descompactado. Não recompacte entradas inalteradas apenas para padronizar: isso criaria ciphertext e histórico desnecessários.

Fluxo para atualizar o SNES no PowerShell:

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
git status --short
```

Resultado esperado:

- ROM inalterada: mesmo `id`, mesmo caminho de asset e mesmos bytes `.bin`.
- ROM nova ou modificada: somente ela recebe ciphertext novo.
- ROM renomeada sem alteração de conteúdo: ID e asset são preservados.
- Execução sem mudanças: nenhum diff no Git.
- Nunca aceite uma troca em massa de `.bin` como atualização normal. Pare e investigue senha, pasta de saída e comando usados.

Antes de commit/push de catálogo, execute `npm run test:catalog`, `node tools/verify-catalog.mjs <pasta>` com a senha carregada e os testes gerais descritos no README. Use e publique somente ROMs que o proprietário do projeto tenha direito de utilizar e distribuir.

## Tamanho e histórico

- O GitHub Pages publica `site` e tem limite de 1 GB; mantenha margem operacional e reavalie armazenamento externo antes de aproximadamente 750–800 MiB.
- Não reescreva o histórico a cada atualização. A limpeza de blobs antigos é uma manutenção excepcional, requer backup e autorização explícita para force-push.
- Git LFS não serve os arquivos de um site GitHub Pages. Para uma biblioteca grande, mantenha o frontend no Pages e planeje os assets cifrados em armazenamento de objetos.
