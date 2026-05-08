export async function onRequestGet({ env, request }) {
  const token = new URL(request.url).searchParams.get('t');
  if (!token) return resp({ error: 'Token requerido' }, 400);

  const base = 'https://rpaiizqttenkfbiqulng.supabase.co/rest/v1';
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Accept': 'application/json',
  };

  const cRes = await fetch(
    `${base}/clientes?token=eq.${encodeURIComponent(token)}&select=id,nombre`,
    { headers }
  );
  if (!cRes.ok) return resp({ error: 'Error de base de datos' }, 500);
  const clientes = await cRes.json();
  if (!Array.isArray(clientes) || !clientes.length) return resp({ error: 'No encontrado' }, 404);
  const cliente = clientes[0];

  const oRes = await fetch(
    `${base}/ordenes?cliente_id=eq.${cliente.id}&select=id,producto,created_at,precio_venta_gtq,estado,entregado,pagos(fecha,monto,metodo)&order=created_at.desc`,
    { headers }
  );
  if (!oRes.ok) return resp({ error: 'Error de base de datos' }, 500);
  const ordenes = await oRes.json();

  return resp({ cliente: { nombre: cliente.nombre }, ordenes: ordenes || [] });
}

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
