# LimpaDisco

Mostra o que está ocupando o seu disco, do maior para o menor, em árvore, e apaga com segurança
(pastas do sistema são bloqueadas e tudo vai para a Lixeira, a não ser que você peça "excluir de vez").

Para deixar a faxina divertida, dá para **batalhar** contra o arquivo antes de apagá-lo:
uma batalha de desvio, um duelo por turnos com o Clawd, uma batalha 3D em grupo e uma batalha psicodélica em primeira pessoa.
Arquivos de 1 GB ou mais viram chefão.

## Baixar

Pegue o `LimpaDisco.exe` na página de [Releases](../../releases) e abra.

Precisa de:
- Windows 10 ou 11
- [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/10.0)
- WebView2 (já vem no Windows 11 e no Windows 10 atualizado)

Na primeira vez o Windows pode mostrar "O Windows protegeu o computador", porque o programa não tem
assinatura digital: clique em **Mais informações → Executar assim mesmo**.

## Pastas

- `src/` — código: o programa em C# e a interface (HTML + batalhas em JavaScript)
- `assets/` — ícone do app, ícones dos botões e músicas das batalhas
- `tools/` — script que gera o ícone

## Compilar

```
dotnet publish -c Release -o app -p:GenerateDocumentationFile=false
```

As músicas das batalhas (`musica*.mp3`) e os ícones em `icones/` são de terceiros e pertencem aos seus donos;
este é um projeto pessoal, sem fins lucrativos.
