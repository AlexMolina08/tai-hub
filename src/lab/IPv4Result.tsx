import type { IPv4Calculation, IPv4Comparison, IPv4Prediction } from './ipv4'

const comparisonText = { correct: 'Coincide', incorrect: 'Revisa este valor', omitted: 'Sin predecir', 'not-asked': 'No solicitado' }

/** Called only after the reveal and its prediction have been persisted. */
export function IPv4Result({ result, comparison, prediction }: {
  result: IPv4Calculation; comparison: IPv4Comparison; prediction: IPv4Prediction
}) {
  const octets = result.address.split('.').map(Number)
  return <section className="lab-ipv4-result" aria-label="Resultado del bloque IPv4">
    <h4>Tu bloque, paso a paso</h4>
    <p><strong>{result.address}/{result.prefix}</strong> · máscara {result.mask}</p>
    <div className="lab-ipv4-bits" role="img" aria-label={`Dirección ${result.address} en binario. ${result.prefix} bits de prefijo y ${result.hostBits} bits restantes.`}>
      {octets.map((octet, index) => <div className="lab-ipv4-octet" key={index} aria-hidden="true">
        <span>{octet}</span><div>{octet.toString(2).padStart(8, '0').split('').map((bit, b) =>
          <span className={index * 8 + b < result.prefix ? 'lab-ipv4-prefix-bit' : ''} key={b}>{bit}</span>)}</div>
      </div>)}
    </div>
    <p className="lab-mode">Los primeros {result.prefix} bits identifican el prefijo. Los {result.hostBits} restantes delimitan el bloque.</p>
    <dl className="lab-ipv4-values">
      <div><dt>Límite inferior</dt><dd>{result.lower}</dd></div>
      <div><dt>Límite superior</dt><dd>{result.upper}</dd></div>
      <div><dt>Direcciones en el bloque</dt><dd>{result.addressCount.toLocaleString('es-ES')}</dd></div>
      {result.probe && <div><dt>Dirección de prueba: {result.probe}</dt><dd>{result.probeMember ? 'Dentro del bloque' : 'Fuera del bloque'}</dd></div>}
    </dl>
    <section aria-label="Comparación con tu predicción">
      <h4>Compara con tu predicción</h4>
      {prediction.omitted && <p>Omitiste la predicción. El cálculo no cuenta como un acierto.</p>}
      <ul className="lab-ipv4-comparisons">
        <li><span>Límite inferior: <strong>{prediction.lower || '—'}</strong></span><span>{comparisonText[comparison.lower]}</span></li>
        <li><span>Límite superior: <strong>{prediction.upper || '—'}</strong></span><span>{comparisonText[comparison.upper]}</span></li>
        {comparison.member !== 'not-asked' && <li><span>Pertenencia: <strong>{prediction.member === 'yes' ? 'Dentro' : prediction.member === 'no' ? 'Fuera' : '—'}</strong></span><span>{comparisonText[comparison.member]}</span></li>}
      </ul>
    </section>
    <section aria-label="Interpretación del contexto">
      <h4>Qué significa en este contexto</h4>
      <p>{result.interpretation.explanation}</p>
      {result.interpretation.conventionalInterior && <p>Intervalo interior: <strong>{result.interpretation.conventionalInterior.lower}–{result.interpretation.conventionalInterior.upper}</strong> ({result.interpretation.conventionalInterior.count.toLocaleString('es-ES')} direcciones).</p>}
      {result.interpretation.pointToPointEndpoints && <p>Extremos del enlace declarado: <strong>{result.interpretation.pointToPointEndpoints.join(' y ')}</strong>.</p>}
      {prediction.interpretationNote && <><h4>Tu explicación</h4><p className="lab-ipv4-note">{prediction.interpretationNote}</p><p className="lab-mode">Texto conservado para comparar; no se califica automáticamente.</p></>}
    </section>
  </section>
}
