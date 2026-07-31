# Changelog

Todas as mudanças relevantes do VisionLoop, da versão mais recente para a mais antiga.

## Como versionar

O padrão de nome é **`AAAA-MM-DD_VisionLoop-X.Y.Z`**, usado igual na pasta e no zip — por exemplo `2026-07-31_VisionLoop-0.0.8.zip`. O campo `"version"` do `package.json` recebe só o número (`0.0.8`) e deve bater sempre com o do nome.

A data vai no formato ano-mês-dia justamente porque assim a ordem alfabética e a cronológica são a mesma coisa: a pasta se organiza sozinha, da versão mais antiga para a mais nova, sem depender de datas de modificação (que se perdem ao copiar ou descompactar arquivos). Escrita como dia-mês-ano isso não funcionaria.

Sobre qual número mexer: suba o último em correções e ajustes, o do meio quando entrar funcionalidade nova, e o primeiro só se algo quebrar a compatibilidade com o que já existia. O "o que mudou" fica aqui neste arquivo, nunca no nome do zip.

---

## 0.0.8 — 31/07/2026

Versão de limpeza: o app deixou de ser um sistema de rede local e passou a assumir de vez que roda na web (Render). Junto vieram correções de bugs de upload e o enxugamento dos formatos aceitos.

### Formatos aceitos

- **Vídeo**: `.mp4`, `.mov` (formato padrão do iPhone) e `.webm`.
- **Imagem**: `.jpg`/`.jpeg`, `.png` e `.webp`.
- Removidos `.mkv`, `.avi` e `.gif` — formatos pouco usados neste cenário. O upload agora os recusa com "Formato não suportado".
- Arquivos desses formatos que já estejam na pasta `videos/` do servidor continuam sendo listados e reproduzidos; só o envio de novos está bloqueado.

### Corrigido

- **Todo upload `.mp4` ganhava ` (1)` no nome.** Depois da conversão, o nome final era calculado enquanto o arquivo original ainda estava no disco. Como para um `.mp4` o nome desejado era idêntico ao do original, o sistema enxergava uma colisão do arquivo consigo mesmo e renomeava para `Nome (1).mp4`. Uploads de outras extensões não sofriam, porque a extensão mudava para `.mp4` no caminho. Agora o arquivo convertido substitui o original e o nome enviado é preservado. Colisão real com um arquivo já existente continua gerando ` (1)`, sem sobrescrever nada.
- **Arquivo temporário aparecia na biblioteca.** Os temporários `.transcoding_*.mp4` criados durante a conversão podiam surgir na grade do controlador com nome estranho. Agora ficam ocultos.
- **Sobras de conversões interrompidas.** Se o servidor caísse ou reiniciasse no meio de um upload, o temporário ficava no disco para sempre. Agora são apagados na inicialização.
- **Erro 404 de `/favicon.ico` no console.** Adicionada a rota servindo o ícone do app, e as páginas passaram a declarar o ícone.
- **Aviso `Allow attribute will take precedence over 'allowfullscreen'`.** O iframe da tela inicial declarava os dois atributos equivalentes; ficou só o `allowfullscreen`, que funciona tanto em navegador moderno quanto nos navegadores antigos de Smart TV.
- **Falha que derrubava o servidor.** Um acesso a arquivo com extensão fora da tabela de tipos MIME lançava erro não tratado e encerrava o processo — cenário que a própria remoção de formatos tornava possível.

### Alterado

- **Uploads múltiplos agora são sequenciais.** Ao selecionar ou arrastar vários arquivos, eles entram numa fila e sobem um de cada vez; o próximo só começa quando o anterior termina de enviar e de ser convertido. Antes todos subiam em paralelo, saturando a conexão e o servidor.
- **Removido tudo que era específico de rede local**: o endpoint que descobria o IP da máquina, a varredura de porta livre (a porta agora vem sempre da variável de ambiente `PORT`, definida pelo Render) e o endereço de fallback `localhost:3000` na conexão em tempo real.
- A mensagem "nenhuma TV conectada" passou a explicar o fluxo real (abrir o site na TV e digitar o código de sala) em vez de mandar abrir um arquivo.
- `README.md` reescrito para o cenário web, com seção de hospedagem no Render e solução de problemas atualizada.

### Removido

- `NOVAS_FUNCIONALIDADES.md` — documentação obsoleta, não lida pelo app; o conteúdo relevante está no README e o histórico, aqui.
- `videos/Video-Teste1.mp4` e `videos/Video-Teste2.mp4` — vídeos de exemplo que apareciam na grade como se fossem conteúdo do usuário. O pacote caiu de ~12 MB para ~291 KB.

### Interno

- As constantes de formato foram unificadas: nove cópias da mesma verificação de imagem no controlador viraram uma constante única, o que evita que uma mudança de formato fique pela metade no futuro.

---

## Versões anteriores

Reconstruído a partir da documentação que acompanhava os pacotes; pode não estar completo.

### 0.0.7 — junho/2026

- Suporte a imagens além de vídeos, com tempo de exibição configurável por imagem (1 a 300 segundos, padrão 10).
- Playlists mistas, combinando vídeos e imagens na mesma sequência; vídeos tocam até o fim, imagens respeitam o tempo configurado.
- Conversão automática de todo vídeo enviado para HD (1280x720, H.264 Main + AAC, com o índice no início do arquivo), resolvendo travamentos causados por codec incompatível, resolução alta demais ou arquivos sem índice.
- Detecção de vídeo "congelado" na TV, sem erro explícito, com pulo automático para o próximo item.
- Pareamento por código de sala de 5 dígitos: cada controlador só enxerga e comanda as TVs pareadas com ele.

### 0.0.6

Versão base: controle de vídeos em loop para TVs, com reprodução, pausa, retomada, parada e transmissão simultânea para todas as TVs.
