# shellcheck shell=bash
#
# Coordenadas de la infraestructura de despliegue. Se SOURCEA desde los scripts
# de deploy/provisioning; no se ejecuta suelto.
#
# Por que existe: estos valores son la direccion del nodo manager del Swarm y de
# su registry. Iban incrustados como valor por defecto en siete scripts, y este
# repo tiene un espejo PUBLICO en GitHub — es decir, estaban publicando donde
# vive la infraestructura. Aqui no hay ningun default: si falta la variable, el
# script para con un mensaje, en vez de apuntar a una maquina equivocada.
#
# Configuracion (una sola vez, en la maquina desde la que se despliega):
#
#   cp .deploy.env.example .deploy.env    # .deploy.env esta en .gitignore
#   $EDITOR .deploy.env
#
# o exportando IAS_HOST y REGISTRY en el entorno.

_deploy_env_file="${REPO_ROOT:-$(pwd)}/.deploy.env"
# shellcheck source=/dev/null
[[ -f "$_deploy_env_file" ]] && . "$_deploy_env_file"
unset _deploy_env_file

HOST="${IAS_HOST:?falta IAS_HOST — copia .deploy.env.example a .deploy.env o exporta la variable}"
REGISTRY="${REGISTRY:?falta REGISTRY — copia .deploy.env.example a .deploy.env o exporta la variable}"
